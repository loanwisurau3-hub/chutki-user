package com.chutki.customer.webrtc

import android.content.Intent
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * ChutkiFcmService wakes up the app when the Android process is killed/backgrounded
 * and a Rider initiates an in-app WebRTC voice call via high-priority FCM data payload.
 */
class ChutkiFcmService : FirebaseMessagingService() {

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        if (data["type"] == "INCOMING_RIDER_CALL") {
            val status = data["status"] ?: "RINGING"
            val callerRole = data["callerRole"] ?: "RIDER"
            val orderId = data["orderId"] ?: return
            val callId = data["callId"] ?: return
            val riderUid = data["riderUid"] ?: return
            val riderName = data["riderName"] ?: "Chutki Delivery Partner"
            val tripId = data["tripId"] ?: orderId
            val updatedAt = data["updatedAt"]?.toLongOrNull() ?: System.currentTimeMillis()

            // Ignore stale call notifications older than 60s
            if (status == "RINGING" && callerRole == "RIDER" && (System.currentTimeMillis() - updatedAt) <= 60_000L) {
                val serviceIntent = Intent(this, CallForegroundService::class.java).apply {
                    putExtra(CallForegroundService.EXTRA_MODE, CallForegroundService.MODE_INCOMING)
                    putExtra("orderId", orderId)
                    putExtra("callId", callId)
                    putExtra("riderUid", riderUid)
                    putExtra("riderName", riderName)
                    putExtra("tripId", tripId)
                }
                ContextCompat.startForegroundService(this, serviceIntent)
            }
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // Token is saved to users/{customerUid}/fcmToken when customer logs in
    }
}
