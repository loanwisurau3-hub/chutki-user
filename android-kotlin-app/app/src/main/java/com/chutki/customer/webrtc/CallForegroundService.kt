package com.chutki.customer.webrtc

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.chutki.customer.ui.ActiveCallActivity
import com.chutki.customer.ui.IncomingCallActivity

/**
 * CallForegroundService handles Android background execution & incoming call full-screen notifications
 * while respecting Android 14+ foreground service microphone/phoneCall requirements.
 */
class CallForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_INCOMING
        val orderId = intent?.getStringExtra("orderId") ?: ""
        val callId = intent?.getStringExtra("callId") ?: ""
        val riderName = intent?.getStringExtra("riderName") ?: "Chutki Delivery Partner"
        val riderUid = intent?.getStringExtra("riderUid") ?: ""
        val tripId = intent?.getStringExtra("tripId") ?: orderId

        val notification = if (mode == MODE_ACTIVE) {
            buildActiveCallNotification(orderId, callId, riderUid, riderName, tripId)
        } else {
            buildIncomingCallNotification(orderId, callId, riderUid, riderName, tripId)
        }

        startForeground(NOTIFICATION_ID, notification)
        return START_NOT_STICKY
    }

    private fun buildIncomingCallNotification(
        orderId: String,
        callId: String,
        riderUid: String,
        riderName: String,
        tripId: String
    ): Notification {
        val fullScreenIntent = Intent(this, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("orderId", orderId)
            putExtra("callId", callId)
            putExtra("riderUid", riderUid)
            putExtra("riderName", riderName)
            putExtra("tripId", tripId)
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            101,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle("Incoming Call • $riderName")
            .setContentText("Chutki Order #$orderId Voice Call")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .build()
    }

    private fun buildActiveCallNotification(
        orderId: String,
        callId: String,
        riderUid: String,
        riderName: String,
        tripId: String
    ): Notification {
        val activeIntent = Intent(this, ActiveCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("orderId", orderId)
            putExtra("callId", callId)
            putExtra("riderUid", riderUid)
            putExtra("riderName", riderName)
            putExtra("tripId", tripId)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            102,
            activeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle("In-App Voice Call • $riderName")
            .setContentText("Order #$orderId • Audio Protected (No Phone Number Shared)")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Chutki Rider Voice Calls",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "WhatsApp-style In-App Rider Voice Calls"
                setSound(null, null)
            }
            manager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "chutki_rider_voip_channel"
        const val NOTIFICATION_ID = 4109
        const val EXTRA_MODE = "service_mode"
        const val MODE_INCOMING = "INCOMING"
        const val MODE_ACTIVE = "ACTIVE"
    }
}
