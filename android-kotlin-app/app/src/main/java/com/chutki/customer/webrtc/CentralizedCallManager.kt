package com.chutki.customer.webrtc

import android.content.Context
import android.content.Intent
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import com.chutki.customer.ChutkiApplication
import com.chutki.customer.models.InAppCallRecord
import com.chutki.customer.models.OrderRecord
import com.chutki.customer.ui.IncomingCallActivity
import com.google.firebase.database.*
import java.util.concurrent.ConcurrentHashMap

class CentralizedCallManager private constructor(private val appContext: Context) {

    companion object {
        const val CALL_RING_TIMEOUT_MS = 60_000L

        @Volatile
        private var instance: CentralizedCallManager? = null

        fun getInstance(context: Context): CentralizedCallManager {
            return instance ?: synchronized(this) {
                instance ?: CentralizedCallManager(context.applicationContext).also { instance = it }
            }
        }
    }

    private val dbRef: DatabaseReference =
        FirebaseDatabase.getInstance(ChutkiApplication.FIREBASE_DB_URL).reference
    private val handledCallIds = ConcurrentHashMap.newKeySet<String>()
    private val activeOrdersMap = ConcurrentHashMap<String, OrderRecord>()

    private var inboxRef: DatabaseReference? = null
    private var inboxListener: ValueEventListener? = null
    private var ordersQuery: Query? = null
    private var ordersListener: ValueEventListener? = null

    @Volatile
    var currentActiveCallId: String? = null

    private var activeRingtone: Ringtone? = null

    fun startWatchingCustomerCalls(customerUid: String) {
        stopWatching()

        // 1. Track active customer orders to validate incoming call orderId
        ordersQuery = dbRef.child("orders").orderByChild("customerUid").equalTo(customerUid)
        ordersListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                activeOrdersMap.clear()
                for (child in snapshot.children) {
                    val orderId = child.key ?: continue
                    val record = OrderRecord(
                        orderId = orderId,
                        batchGroupId = child.child("batchGroupId").getValue(String::class.java),
                        customerUid = child.child("customerUid").getValue(String::class.java) ?: "",
                        restaurantId = child.child("restaurantId").getValue(String::class.java) ?: "",
                        deliveryUid = child.child("deliveryUid").getValue(String::class.java),
                        status = child.child("status").getValue(String::class.java) ?: "PLACED"
                    )
                    if (record.isRiderCommunicationEligible()) {
                        activeOrdersMap[orderId] = record
                    }
                }
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        ordersQuery?.addValueEventListener(ordersListener!!)

        // 2. Listen to customerCallInbox/{customerUid}
        inboxRef = dbRef.child("customerCallInbox").child(customerUid)
        inboxListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (!snapshot.exists()) return
                handleIncomingSnapshot(snapshot, customerUid)
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        inboxRef?.addValueEventListener(inboxListener!!)
    }

    fun handleIncomingSnapshot(snapshot: DataSnapshot, loggedInCustomerUid: String) {
        val callId = snapshot.child("callId").getValue(String::class.java)?.trim() ?: return
        val orderId = snapshot.child("orderId").getValue(String::class.java)?.trim() ?: return
        val tripId = snapshot.child("tripId").getValue(String::class.java)?.trim() ?: orderId
        val status = snapshot.child("status").getValue(String::class.java)?.trim() ?: return
        val callerRole = snapshot.child("callerRole").getValue(String::class.java)?.trim() ?: return
        val customerUid = snapshot.child("customerUid").getValue(String::class.java)?.trim() ?: return
        val riderUid = snapshot.child("riderUid").getValue(String::class.java)?.trim() ?: ""
        val riderName = snapshot.child("riderName").getValue(String::class.java)?.trim() ?: "Delivery Rider"
        val riderPhotoUrl = snapshot.child("riderPhotoUrl").getValue(String::class.java)
        val updatedAt = snapshot.child("updatedAt").getValue(Long::class.java) ?: 0L

        if (status != "RINGING" || callerRole != "RIDER") return
        if (customerUid != loggedInCustomerUid) return
        if (System.currentTimeMillis() - updatedAt > CALL_RING_TIMEOUT_MS) return
        if (handledCallIds.contains(callId)) return

        // Verify order belongs to an active rider-assigned order
        val matchedOrder = activeOrdersMap[orderId]
            ?: activeOrdersMap.values.firstOrNull { it.canonicalTripId == tripId }
            ?: return

        handledCallIds.add(callId)

        // Busy check if already on another call
        val existingCallId = currentActiveCallId
        if (existingCallId != null && existingCallId != callId) {
            writeCallStatusMultiPath(
                orderId = matchedOrder.orderId,
                tripId = matchedOrder.canonicalTripId,
                customerUid = loggedInCustomerUid,
                riderUid = riderUid,
                status = "BUSY",
                customerAnswered = false
            )
            return
        }

        currentActiveCallId = callId
        startRingtoneAndVibration()

        val intent = Intent(appContext, IncomingCallActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("callId", callId)
            putExtra("orderId", matchedOrder.orderId)
            putExtra("tripId", matchedOrder.canonicalTripId)
            putExtra("riderUid", riderUid)
            putExtra("riderName", riderName)
            putExtra("riderPhotoUrl", riderPhotoUrl)
            putExtra("customerUid", loggedInCustomerUid)
        }
        appContext.startActivity(intent)
    }

    fun writeOutgoingCustomerCall(call: InAppCallRecord, onComplete: (Boolean) -> Unit) {
        handledCallIds.add(call.callId)
        currentActiveCallId = call.callId
        val map = call.toFirebaseMap()
        val updates = hashMapOf<String, Any?>(
            "inAppCalls/${call.orderId}" to map,
            "riderCallInbox/${call.riderUid}" to map
        )
        if (call.tripId.isNotBlank() && call.tripId != call.orderId) {
            updates["inAppCalls/${call.tripId}"] = map
        }
        dbRef.updateChildren(updates).addOnCompleteListener { task ->
            onComplete(task.isSuccessful)
        }
    }

    fun writeCallStatusMultiPath(
        orderId: String,
        tripId: String?,
        customerUid: String,
        riderUid: String,
        status: String,
        customerAnswered: Boolean,
        clearWebRtc: Boolean = false
    ) {
        val now = System.currentTimeMillis()
        val paths = mutableListOf(
            "inAppCalls/$orderId",
            "customerCallInbox/$customerUid",
            "riderCallInbox/$riderUid"
        )
        if (!tripId.isNullOrBlank() && tripId != orderId) {
            paths.add("inAppCalls/$tripId")
        }
        val updates = hashMapOf<String, Any?>()
        for (base in paths) {
            updates["$base/status"] = status
            updates["$base/customerAnswered"] = customerAnswered
            updates["$base/updatedAt"] = now
        }
        if (clearWebRtc) {
            updates["inAppCalls/$orderId/webrtc"] = null
            if (!tripId.isNullOrBlank() && tripId != orderId) {
                updates["inAppCalls/$tripId/webrtc"] = null
            }
        }
        dbRef.updateChildren(updates)
    }

    fun startRingtoneAndVibration() {
        stopRingtoneAndVibration()
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            activeRingtone = RingtoneManager.getRingtone(appContext, uri)
            activeRingtone?.play()
        } catch (_: Exception) {
        }
        try {
            val vibrator = appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(
                    VibrationEffect.createWaveform(longArrayOf(0, 500, 400, 500), 0)
                )
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(longArrayOf(0, 500, 400, 500), 0)
            }
        } catch (_: Exception) {
        }
    }

    fun stopRingtoneAndVibration() {
        try {
            activeRingtone?.stop()
            activeRingtone = null
        } catch (_: Exception) {
        }
        try {
            val vibrator = appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            vibrator?.cancel()
        } catch (_: Exception) {
        }
    }

    fun stopWatching() {
        stopRingtoneAndVibration()
        inboxListener?.let { inboxRef?.removeEventListener(it) }
        ordersListener?.let { ordersQuery?.removeEventListener(it) }
        currentActiveCallId = null
    }
}
