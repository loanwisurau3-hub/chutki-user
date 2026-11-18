package com.chutki.customer.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import coil.load
import com.chutki.customer.ChutkiApplication
import com.chutki.customer.databinding.ActivityActiveCallBinding
import com.chutki.customer.models.InAppCallRecord
import com.chutki.customer.models.SecurityAndGeoUtils
import com.chutki.customer.webrtc.CallForegroundService
import com.chutki.customer.webrtc.CentralizedCallManager
import com.chutki.customer.webrtc.WebRtcVoiceCallEngine
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.ValueEventListener
import org.webrtc.PeerConnection

/**
 * ActiveCallActivity:
 * Handles both Customer Outgoing Calls and Answered Incoming Rider Calls.
 * - Requests RECORD_AUDIO runtime permission cleanly before starting microphone capture
 * - Writes CONNECTED to Firebase ONLY after WebRTC PeerConnection reaches CONNECTED/COMPLETED
 * - Displays real call duration timer based strictly on actual connectedAt timestamp
 * - Controls real WebRTC audio track mute and Android AudioManager speaker routing
 * - Enforces 60-second unanswered ringing timeout based on actual timestamps
 */
class ActiveCallActivity : AppCompatActivity() {

    private lateinit var binding: ActivityActiveCallBinding
    private val db by lazy { ChutkiApplication.database }

    private var isOutgoing: Boolean = true
    private var orderId: String = ""
    private var tripId: String = ""
    private var callId: String = ""
    private var riderUid: String = ""
    private var riderName: String = "Delivery Partner"
    private var riderPhoto: String = ""
    private var customerUid: String = ""
    private var customerLabel: String = ""
    private var dropAddress: String = ""

    private var webRtcEngine: WebRtcVoiceCallEngine? = null
    private var connectedAtMs: Long? = null
    private var startedAtMs: Long = 0L
    private var isMuted: Boolean = false
    private var isSpeakerOn: Boolean = false
    private var isCleaningUp: Boolean = false

    private var callStatusListener: ValueEventListener? = null
    private val uiHandler = Handler(Looper.getMainLooper())

    private val durationRunnable = object : Runnable {
        override fun run() {
            val connectedAt = connectedAtMs
            if (connectedAt != null) {
                val elapsedSec = ((System.currentTimeMillis() - connectedAt) / 1000L).coerceAtLeast(0L)
                binding.tvCallStatus.text = SecurityAndGeoUtils.formatCallDuration(elapsedSec)
            } else if (startedAtMs > 0L && (System.currentTimeMillis() - startedAtMs) > 60_000L) {
                // Real 60-second signaling expiry for unanswered calls
                terminateCallWithStatus("TIMEOUT")
                return
            }
            uiHandler.postDelayed(this, 1000L)
        }
    }

    private val micPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            beginWebRtcSession()
        } else {
            binding.tvCallStatus.text = "Mic Permission Needed • Tap Mute to Enable"
            Toast.makeText(
                this,
                "Please allow Microphone access to speak with your Rider. Tap 'Mute Mic' to retry.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityActiveCallBinding.inflate(layoutInflater)
        setContentView(binding.root)

        isOutgoing = intent.getBooleanExtra("isOutgoing", true)
        orderId = intent.getStringExtra("orderId") ?: ""
        tripId = intent.getStringExtra("tripId") ?: orderId
        callId = intent.getStringExtra("callId") ?: "call_${System.currentTimeMillis()}"
        riderUid = intent.getStringExtra("riderUid") ?: ""
        riderName = intent.getStringExtra("riderName") ?: "Delivery Partner"
        riderPhoto = intent.getStringExtra("riderPhoto") ?: ""
        customerUid = intent.getStringExtra("customerUid") ?: "cust_demo_01"
        customerLabel = intent.getStringExtra("customerLabel") ?: "Customer • #${orderId.takeLast(5)}"
        dropAddress = intent.getStringExtra("dropAddress") ?: ""

        CentralizedCallManager.onCallActive(callId)

        binding.tvActiveRiderName.text = riderName
        binding.tvActiveOrderBadge.text = "Order #${orderId.takeLast(6).uppercase()} • Number Hidden"
        binding.tvCallStatus.text = if (isOutgoing) "Calling Rider..." else "Connecting WebRTC Voice..."

        if (riderPhoto.isNotBlank()) {
            binding.ivActiveRiderAvatar.load(riderPhoto)
        }

        binding.btnToggleMute.setOnClickListener {
            val engine = webRtcEngine
            if (engine == null) {
                checkMicPermissionAndStart()
                return@setOnClickListener
            }
            isMuted = !isMuted
            engine.setMicrophoneMuted(isMuted)
            binding.btnToggleMute.text = if (isMuted) "Unmute Mic" else "Mute Mic"
            db.getReference("inAppCalls/$orderId/isMuted").setValue(isMuted)
        }

        binding.btnToggleSpeaker.setOnClickListener {
            val engine = webRtcEngine ?: return@setOnClickListener
            isSpeakerOn = !isSpeakerOn
            engine.setSpeakerphoneEnabled(isSpeakerOn)
            binding.btnToggleSpeaker.text = if (isSpeakerOn) "Speaker ON" else "Speaker OFF"
        }

        binding.btnEndCall.setOnClickListener {
            val finalStatus = if (connectedAtMs != null) "ENDED" else if (isOutgoing) "ENDED" else "DECLINED"
            terminateCallWithStatus(finalStatus)
        }

        checkMicPermissionAndStart()
    }

    private fun checkMicPermissionAndStart() {
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            beginWebRtcSession()
        } else {
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun beginWebRtcSession() {
        startedAtMs = System.currentTimeMillis()
        uiHandler.post(durationRunnable)

        // Start foreground call service
        val serviceIntent = Intent(this, CallForegroundService::class.java).apply {
            putExtra(CallForegroundService.EXTRA_MODE, CallForegroundService.MODE_ACTIVE)
            putExtra("orderId", orderId)
            putExtra("callId", callId)
            putExtra("riderUid", riderUid)
            putExtra("riderName", riderName)
            putExtra("tripId", tripId)
        }
        ContextCompat.startForegroundService(this, serviceIntent)

        if (isOutgoing) {
            writeCustomerOutgoingSignaling()
        } else {
            // Mark CONNECTING while WebRTC Answer & ICE negotiate; CONNECTED is written ONLY when PeerConnection connects
            db.getReference("inAppCalls/$orderId/status").setValue("CONNECTING")
        }

        observeRemoteSignalingStatus()

        webRtcEngine = WebRtcVoiceCallEngine(
            context = applicationContext,
            database = db,
            orderId = orderId,
            iceServers = buildConfiguredIceServers(),
            listener = object : WebRtcVoiceCallEngine.Listener {
                override fun onPeerConnectionStateChanged(state: PeerConnection.PeerConnectionState) {
                    runOnUiThread {
                        when (state) {
                            PeerConnection.PeerConnectionState.CONNECTING -> {
                                if (connectedAtMs == null) {
                                    binding.tvCallStatus.text = "Connecting..."
                                }
                            }
                            PeerConnection.PeerConnectionState.DISCONNECTED -> {
                                binding.tvCallStatus.text = "Reconnecting audio..."
                            }
                            PeerConnection.PeerConnectionState.FAILED -> {
                                terminateCallWithStatus("FAILED")
                            }
                            else -> {}
                        }
                    }
                }

                override fun onAudioConnected() {
                    runOnUiThread {
                        if (connectedAtMs == null) {
                            connectedAtMs = System.currentTimeMillis()
                            writeConnectedStateAfterPeerConnectionEstablished()
                        }
                    }
                }

                override fun onCallFailed(reason: String) {
                    runOnUiThread {
                        Toast.makeText(this@ActiveCallActivity, reason, Toast.LENGTH_SHORT).show()
                        terminateCallWithStatus("FAILED")
                    }
                }
            }
        ).also { engine ->
            if (isOutgoing) {
                engine.startOutgoingCall()
            } else {
                engine.answerIncomingCall()
            }
        }
    }

    private fun buildConfiguredIceServers(): List<PeerConnection.IceServer> {
        val list = mutableListOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
        )
        // Optional TURN server injected via BuildConfig / secure runtime config (never hardcoded public secrets)
        val turnUrl = intent.getStringExtra("turnUrl")
        val turnUser = intent.getStringExtra("turnUsername")
        val turnPass = intent.getStringExtra("turnCredential")
        if (!turnUrl.isNullOrBlank() && !turnUser.isNullOrBlank() && !turnPass.isNullOrBlank()) {
            list.add(
                PeerConnection.IceServer.builder(turnUrl)
                    .setUsername(turnUser)
                    .setPassword(turnPass)
                    .createIceServer()
            )
        }
        return list
    }

    private fun writeCustomerOutgoingSignaling() {
        val now = System.currentTimeMillis()
        val record = InAppCallRecord(
            callId = callId,
            tripId = tripId.ifBlank { orderId },
            orderId = orderId,
            callerRole = "CUSTOMER",
            riderUid = riderUid,
            riderName = riderName,
            customerUid = customerUid,
            customerLabel = customerLabel,
            dropAddress = dropAddress,
            status = "RINGING",
            customerAnswered = false,
            isMuted = false,
            isOnHold = false,
            startedAt = now,
            updatedAt = now
        )
        val updates = mutableMapOf<String, Any?>(
            "inAppCalls/$orderId" to record.toMap(),
            "riderCallInbox/$riderUid" to record.toMap()
        )
        if (tripId.isNotBlank() && tripId != orderId) {
            updates["inAppCalls/$tripId"] = record.toMap()
        }
        db.reference.updateChildren(updates)
        binding.tvCallStatus.text = "Ringing..."
    }

    private fun writeConnectedStateAfterPeerConnectionEstablished() {
        val now = System.currentTimeMillis()
        val updates = mutableMapOf<String, Any?>(
            "inAppCalls/$orderId/status" to "CONNECTED",
            "inAppCalls/$orderId/customerAnswered" to true,
            "inAppCalls/$orderId/updatedAt" to now
        )
        if (tripId.isNotBlank() && tripId != orderId) {
            updates["inAppCalls/$tripId/status"] = "CONNECTED"
            updates["inAppCalls/$tripId/customerAnswered"] = true
            updates["inAppCalls/$tripId/updatedAt"] = now
        }
        if (customerUid.isNotBlank()) {
            updates["customerCallInbox/$customerUid/status"] = "CONNECTED"
            updates["customerCallInbox/$customerUid/customerAnswered"] = true
            updates["customerCallInbox/$customerUid/updatedAt"] = now
        }
        if (riderUid.isNotBlank()) {
            updates["riderCallInbox/$riderUid/status"] = "CONNECTED"
            updates["riderCallInbox/$riderUid/customerAnswered"] = true
            updates["riderCallInbox/$riderUid/updatedAt"] = now
        }
        db.reference.updateChildren(updates)
    }

    private fun observeRemoteSignalingStatus() {
        val ref = db.getReference("inAppCalls/$orderId/status")
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val status = snapshot.getValue(String::class.java) ?: return
                when (status) {
                    "RINGING" -> if (connectedAtMs == null && isOutgoing) {
                        binding.tvCallStatus.text = "Ringing..."
                    }
                    "CONNECTING" -> if (connectedAtMs == null) {
                        binding.tvCallStatus.text = "Connecting..."
                    }
                    "DECLINED", "BUSY", "ENDED", "TIMEOUT", "FAILED" -> {
                        if (!isCleaningUp) {
                            binding.tvCallStatus.text = "Call $status"
                            cleanupAndFinish()
                        }
                    }
                }
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        ref.addValueEventListener(listener)
        callStatusListener = listener
    }

    private fun terminateCallWithStatus(finalStatus: String) {
        if (isCleaningUp) return
        isCleaningUp = true

        val now = System.currentTimeMillis()
        val updates = mutableMapOf<String, Any?>(
            "inAppCalls/$orderId/status" to finalStatus,
            "inAppCalls/$orderId/customerAnswered" to false,
            "inAppCalls/$orderId/updatedAt" to now,
            "inAppCalls/$orderId/webrtc" to null
        )
        if (tripId.isNotBlank() && tripId != orderId) {
            updates["inAppCalls/$tripId/status"] = finalStatus
            updates["inAppCalls/$tripId/customerAnswered"] = false
            updates["inAppCalls/$tripId/updatedAt"] = now
        }
        if (customerUid.isNotBlank()) {
            updates["customerCallInbox/$customerUid/status"] = finalStatus
            updates["customerCallInbox/$customerUid/customerAnswered"] = false
            updates["customerCallInbox/$customerUid/updatedAt"] = now
        }
        if (riderUid.isNotBlank()) {
            updates["riderCallInbox/$riderUid/status"] = finalStatus
            updates["riderCallInbox/$riderUid/customerAnswered"] = false
            updates["riderCallInbox/$riderUid/updatedAt"] = now
        }
        db.reference.updateChildren(updates)
        cleanupAndFinish()
    }

    private fun cleanupAndFinish() {
        isCleaningUp = true
        uiHandler.removeCallbacks(durationRunnable)
        callStatusListener?.let {
            db.getReference("inAppCalls/$orderId/status").removeEventListener(it)
        }
        callStatusListener = null
        webRtcEngine?.release()
        webRtcEngine = null
        CentralizedCallManager.onCallEnded()
        stopService(Intent(this, CallForegroundService::class.java))
        finish()
    }

    override fun onDestroy() {
        if (!isCleaningUp) {
            terminateCallWithStatus(if (connectedAtMs != null) "ENDED" else "DECLINED")
        }
        super.onDestroy()
    }
}
