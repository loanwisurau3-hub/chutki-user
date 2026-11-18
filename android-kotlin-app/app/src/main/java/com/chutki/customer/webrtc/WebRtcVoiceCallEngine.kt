package com.chutki.customer.webrtc

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.chutki.customer.BuildConfig
import com.chutki.customer.ChutkiApplication
import com.google.firebase.database.*
import org.webrtc.*
import java.util.concurrent.CopyOnWriteArrayList

class WebRtcVoiceCallEngine(
    private val appContext: Context,
    private val orderId: String,
    private val tripId: String,
    private val isCaller: Boolean,
    private val listener: Listener
) {
    interface Listener {
        fun onCallStatusChanged(status: String)
        fun onPeerConnected()
        fun onCallFailed(reason: String)
    }

    private val dbRef: DatabaseReference =
        FirebaseDatabase.getInstance(ChutkiApplication.FIREBASE_DB_URL).reference
    private val audioManager: AudioManager =
        appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var audioSource: AudioSource? = null
    private var localAudioTrack: AudioTrack? = null

    private var remoteDescriptionSet = false
    private var connectedNotified = false
    private var cleanedUp = false
    private val pendingRemoteCandidates = CopyOnWriteArrayList<IceCandidate>()
    private val consumedCandidateKeys = HashSet<String>()

    private var remoteSdpListener: ValueEventListener? = null
    private var remoteSdpRef: DatabaseReference? = null
    private var remoteCandidatesListener: ChildEventListener? = null
    private var remoteCandidatesRef: DatabaseReference? = null

    fun start() {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )

        peerConnectionFactory = PeerConnectionFactory.builder()
            .createPeerConnectionFactory()

        val audioConstraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googHighpassFilter", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
        }

        audioSource = peerConnectionFactory?.createAudioSource(audioConstraints)
        localAudioTrack = peerConnectionFactory?.createAudioTrack("CHUTKI_VOICE_TRACK", audioSource)
        localAudioTrack?.setEnabled(true)

        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        setSpeakerphoneEnabled(false)

        val iceServers = mutableListOf(
            PeerConnection.IceServer.builder(
                listOf(
                    "stun:stun.l.google.com:19302",
                    "stun:stun1.l.google.com:19302"
                )
            ).createIceServer()
        )

        if (BuildConfig.TURN_URL.isNotBlank()) {
            val turnBuilder = PeerConnection.IceServer.builder(BuildConfig.TURN_URL)
            if (BuildConfig.TURN_USERNAME.isNotBlank()) {
                turnBuilder.setUsername(BuildConfig.TURN_USERNAME)
            }
            if (BuildConfig.TURN_CREDENTIAL.isNotBlank()) {
                turnBuilder.setPassword(BuildConfig.TURN_CREDENTIAL)
            }
            iceServers.add(turnBuilder.createIceServer())
        }

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        peerConnection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState?) {}

                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                    if (cleanedUp || state == null) return
                    when (state) {
                        PeerConnection.IceConnectionState.CHECKING -> {
                            listener.onCallStatusChanged("CONNECTING")
                        }
                        PeerConnection.IceConnectionState.CONNECTED,
                        PeerConnection.IceConnectionState.COMPLETED -> {
                            if (!connectedNotified) {
                                connectedNotified = true
                                listener.onPeerConnected()
                            }
                        }
                        PeerConnection.IceConnectionState.DISCONNECTED -> {
                            peerConnection?.restartIce()
                        }
                        PeerConnection.IceConnectionState.FAILED -> {
                            listener.onCallFailed("ICE connection failed")
                        }
                        else -> {}
                    }
                }

                override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}

                override fun onIceCandidate(candidate: IceCandidate?) {
                    if (cleanedUp || candidate == null) return
                    val localCandNode = if (isCaller) "callerCandidates" else "receiverCandidates"
                    val payload = mapOf(
                        "candidate" to candidate.sdp,
                        "sdpMid" to candidate.sdpMid,
                        "sdpMLineIndex" to candidate.sdpMLineIndex,
                        "createdAt" to System.currentTimeMillis()
                    )
                    dbRef.child("inAppCalls").child(orderId).child("webrtc")
                        .child(localCandNode).push().setValue(payload)
                    if (tripId.isNotBlank() && tripId != orderId) {
                        dbRef.child("inAppCalls").child(tripId).child("webrtc")
                            .child(localCandNode).push().setValue(payload)
                    }
                }

                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
                override fun onAddStream(stream: MediaStream?) {}
                override fun onRemoveStream(stream: MediaStream?) {}
                override fun onDataChannel(channel: DataChannel?) {}
                override fun onRenegotiationNeeded() {}
                override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {}
            }
        )

        localAudioTrack?.let { track ->
            peerConnection?.addTrack(track, listOf("CHUTKI_STREAM"))
        }

        subscribeToRemoteCandidates()

        if (isCaller) {
            createAndSendOffer()
        } else {
            listenForRemoteOfferAndCreateAnswer()
        }
    }

    private fun subscribeToRemoteCandidates() {
        val remoteCandNode = if (isCaller) "receiverCandidates" else "callerCandidates"
        remoteCandidatesRef = dbRef.child("inAppCalls").child(orderId).child("webrtc").child(remoteCandNode)
        remoteCandidatesListener = object : ChildEventListener {
            override fun onChildAdded(snapshot: DataSnapshot, previousChildName: String?) {
                if (cleanedUp) return
                val key = snapshot.key ?: return
                if (!consumedCandidateKeys.add(key)) return
                val sdp = snapshot.child("candidate").getValue(String::class.java) ?: return
                val sdpMid = snapshot.child("sdpMid").getValue(String::class.java) ?: ""
                val sdpMLineIndex = snapshot.child("sdpMLineIndex").getValue(Int::class.java) ?: 0
                val iceCandidate = IceCandidate(sdpMid, sdpMLineIndex, sdp)
                if (!remoteDescriptionSet) {
                    pendingRemoteCandidates.add(iceCandidate)
                } else {
                    peerConnection?.addIceCandidate(iceCandidate)
                }
            }

            override fun onChildChanged(snapshot: DataSnapshot, previousChildName: String?) {}
            override fun onChildRemoved(snapshot: DataSnapshot) {}
            override fun onChildMoved(snapshot: DataSnapshot, previousChildName: String?) {}
            override fun onCancelled(error: DatabaseError) {}
        }
        remoteCandidatesRef?.addChildEventListener(remoteCandidatesListener!!)
    }

    private fun flushQueuedIceCandidates() {
        if (!remoteDescriptionSet) return
        for (cand in pendingRemoteCandidates) {
            peerConnection?.addIceCandidate(cand)
        }
        pendingRemoteCandidates.clear()
    }

    private fun createAndSendOffer() {
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }
        peerConnection?.createOffer(object : SdpObserverAdapter() {
            override fun onCreateSuccess(desc: SessionDescription?) {
                if (cleanedUp || desc == null) return
                peerConnection?.setLocalDescription(object : SdpObserverAdapter() {}, desc)
                val offerMap = mapOf(
                    "type" to "offer",
                    "sdp" to desc.description
                )
                dbRef.child("inAppCalls").child(orderId).child("webrtc").child("offer").setValue(offerMap)
                if (tripId.isNotBlank() && tripId != orderId) {
                    dbRef.child("inAppCalls").child(tripId).child("webrtc").child("offer").setValue(offerMap)
                }
                listenForRemoteAnswer()
            }

            override fun onCreateFailure(error: String?) {
                listener.onCallFailed(error ?: "Failed to create SDP offer")
            }
        }, constraints)
    }

    private fun listenForRemoteAnswer() {
        remoteSdpRef = dbRef.child("inAppCalls").child(orderId).child("webrtc").child("answer")
        remoteSdpListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (cleanedUp || remoteDescriptionSet || !snapshot.exists()) return
                val type = snapshot.child("type").getValue(String::class.java)
                val sdp = snapshot.child("sdp").getValue(String::class.java)
                if (type == "answer" && !sdp.isNullOrBlank()) {
                    listener.onCallStatusChanged("CONNECTING")
                    val answerDesc = SessionDescription(SessionDescription.Type.ANSWER, sdp)
                    peerConnection?.setRemoteDescription(object : SdpObserverAdapter() {
                        override fun onSetSuccess() {
                            remoteDescriptionSet = true
                            flushQueuedIceCandidates()
                        }
                    }, answerDesc)
                }
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        remoteSdpRef?.addValueEventListener(remoteSdpListener!!)
    }

    private fun listenForRemoteOfferAndCreateAnswer() {
        listener.onCallStatusChanged("CONNECTING")
        remoteSdpRef = dbRef.child("inAppCalls").child(orderId).child("webrtc").child("offer")
        remoteSdpListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (cleanedUp || remoteDescriptionSet || !snapshot.exists()) return
                val type = snapshot.child("type").getValue(String::class.java)
                val sdp = snapshot.child("sdp").getValue(String::class.java)
                if (type == "offer" && !sdp.isNullOrBlank()) {
                    val offerDesc = SessionDescription(SessionDescription.Type.OFFER, sdp)
                    peerConnection?.setRemoteDescription(object : SdpObserverAdapter() {
                        override fun onSetSuccess() {
                            remoteDescriptionSet = true
                            flushQueuedIceCandidates()
                            val answerConstraints = MediaConstraints().apply {
                                mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                                mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
                            }
                            peerConnection?.createAnswer(object : SdpObserverAdapter() {
                                override fun onCreateSuccess(answerDesc: SessionDescription?) {
                                    if (cleanedUp || answerDesc == null) return
                                    peerConnection?.setLocalDescription(object : SdpObserverAdapter() {}, answerDesc)
                                    val answerMap = mapOf(
                                        "type" to "answer",
                                        "sdp" to answerDesc.description
                                    )
                                    dbRef.child("inAppCalls").child(orderId).child("webrtc").child("answer")
                                        .setValue(answerMap)
                                    if (tripId.isNotBlank() && tripId != orderId) {
                                        dbRef.child("inAppCalls").child(tripId).child("webrtc").child("answer")
                                            .setValue(answerMap)
                                    }
                                }
                            }, answerConstraints)
                        }
                    }, offerDesc)
                }
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        remoteSdpRef?.addValueEventListener(remoteSdpListener!!)
    }

    fun setMicrophoneMuted(muted: Boolean) {
        localAudioTrack?.setEnabled(!muted)
    }

    fun setSpeakerphoneEnabled(enabled: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val devices = audioManager.availableCommunicationDevices
            val targetType = if (enabled) {
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
            } else {
                AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            }
            val targetDevice = devices.firstOrNull { it.type == targetType }
            if (targetDevice != null) {
                audioManager.setCommunicationDevice(targetDevice)
            } else if (!enabled) {
                audioManager.clearCommunicationDevice()
            }
        } else {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = enabled
        }
    }

    fun release() {
        if (cleanedUp) return
        cleanedUp = true
        remoteSdpListener?.let { remoteSdpRef?.removeEventListener(it) }
        remoteCandidatesListener?.let { remoteCandidatesRef?.removeEventListener(it) }
        try {
            localAudioTrack?.setEnabled(false)
            localAudioTrack?.dispose()
            audioSource?.dispose()
            peerConnection?.close()
            peerConnection?.dispose()
            peerConnectionFactory?.dispose()
        } catch (_: Exception) {
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = false
        }
        audioManager.mode = AudioManager.MODE_NORMAL
    }

    private open class SdpObserverAdapter : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription?) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {}
        override fun onSetFailure(error: String?) {}
    }
}
