package com.chutki.customer

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.chutki.customer.webrtc.CentralizedCallManager
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase

class ChutkiApplication : Application() {

    companion object {
        const val CALL_CHANNEL_ID = "chutki_rider_voip_calls"
        const val ORDER_CHANNEL_ID = "chutki_order_updates"
        const val FIREBASE_DB_URL = "https://test-2a0d0-default-rtdb.firebaseio.com"
    }

    override fun onCreate() {
        super.onCreate()
        FirebaseApp.initializeApp(this)
        try {
            FirebaseDatabase.getInstance(FIREBASE_DB_URL).setPersistenceEnabled(true)
        } catch (_: Exception) {
        }
        createNotificationChannels()

        FirebaseAuth.getInstance().addAuthStateListener { auth ->
            val user = auth.currentUser
            if (user != null) {
                CentralizedCallManager.getInstance(this).startWatchingCustomerCalls(user.uid)
            } else {
                CentralizedCallManager.getInstance(this).stopWatching()
            }
        }
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java) ?: return
            val callChannel = NotificationChannel(
                CALL_CHANNEL_ID,
                "Rider In-App Voice Calls",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Incoming voice calls from your assigned Chutki delivery rider"
                enableVibration(true)
            }
            val orderChannel = NotificationChannel(
                ORDER_CHANNEL_ID,
                "Order & Chat Updates",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Real-time order tracking and rider chat notifications"
            }
            nm.createNotificationChannel(callChannel)
            nm.createNotificationChannel(orderChannel)
        }
    }
}
