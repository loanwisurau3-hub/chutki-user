package com.chutki.customer.ui

import android.content.Context
import android.content.Intent
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import coil.load
import com.chutki.customer.ChutkiApplication
import com.chutki.customer.databinding.ActivityIncomingCallBinding
import com.chutki.customer.webrtc.CallForegroundService
import com.chutki.customer.webrtc.CentralizedCallManager
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.ValueEventListener

/**
 * IncomingCallActivity:
 * Full-screen WhatsApp-style incoming call UI triggered from any Customer App screen.
 * Plays system ringtone & vibration while ringing, and transitions to ActiveCallActivity
 * when the customer presses Answer.
 */
class IncomingCallActivity : AppCompatActivity() {

    private lateinit var binding: ActivityIncomingCallBinding
    private val db by lazy { ChutkiApplication.database }

    private var orderId: String = ""
    private var tripId: String = ""
    private var callId: String = ""
    private var riderUid: String = ""
    private var riderName: String = "Delivery Rider"
    private var riderPhoto: String = ""
    private var customerUid: String = ""

    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var statusListener: ValueEventListener? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }

        binding = ActivityIncomingCallBinding.inflate(layoutInflater)
        setContentView(binding.root)

        orderId = intent.getStringExtra("orderId") ?: ""
        tripId = intent.getStringExtra("tripId") ?: orderId
        callId = intent.getStringExtra("callId") ?: ""
        riderUid = intent.getStringExtra("riderUid") ?: ""
        riderName = intent.getStringExtra("riderName") ?: "Delivery Partner"
        riderPhoto = intent.getStringExtra("riderPhoto") ?: ""
        customerUid = intent.getStringExtra("customerUid") ?: ""

        binding.tvCallerName.text = riderName
        binding.tvIncomingLabel.text = "Incoming Chutki Voice Call"
        binding.tvOrderBadge.text = "Order #${orderId.takeLast(6).uppercase()}"

        if (riderPhoto.isNotBlank()) {
            binding.ivRiderAvatar.load(riderPhoto)
        }

        startRingtoneAndVibration()
        watchForRemoteCancellation()

        binding.btnAnswerCall.setOnClickListener {
            stopRingtoneAndVibration()
            // Do NOT write CONNECTED here! ActiveCallActivity writes CONNECTED only after
            // WebRTC PeerConnection reaches CONNECTED/COMPLETED state.
            val activeIntent = Intent(this, ActiveCallActivity::class.java).apply {
                putExtra("isOutgoing", false)
                putExtra("orderId", orderId)
                putExtra("tripId", tripId)
                putExtra("callId", callId)
                putExtra("riderUid", riderUid)
                putExtra("riderName", riderName)
                putExtra("riderPhoto", riderPhoto)
                putExtra("customerUid", customerUid)
            }
            startActivity(activeIntent)
            finish()
        }

        binding.btnDeclineCall.setOnClickListener {
            stopRingtoneAndVibration()
            writeDeclinedStatus()
            CentralizedCallManager.onCallEnded()
            stopService(Intent(this, CallForegroundService::class.java))
            finish()
        }
    }

    private fun startRingtoneAndVibration() {
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(applicationContext, uri)
            ringtone?.play()
        } catch (_: Exception) {}

        try {
            vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            val pattern = longArrayOf(0, 500, 400, 500, 1000)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
        } catch (_: Exception) {}
    }

    private fun stopRingtoneAndVibration() {
        try {
            ringtone?.stop()
        } catch (_: Exception) {}
        try {
            vibrator?.cancel()
        } catch (_: Exception) {}
    }

    private fun writeDeclinedStatus() {
        val now = System.currentTimeMillis()
        val updates = mutableMapOf<String, Any?>(
            "inAppCalls/$orderId/status" to "DECLINED",
            "inAppCalls/$orderId/customerAnswered" to false,
            "inAppCalls/$orderId/updatedAt" to now
        )
        if (tripId.isNotBlank() && tripId != orderId) {
            updates["inAppCalls/$tripId/status"] = "DECLINED"
            updates["inAppCalls/$tripId/customerAnswered"] = false
            updates["inAppCalls/$tripId/updatedAt"] = now
        }
        if (customerUid.isNotBlank()) {
            updates["customerCallInbox/$customerUid/status"] = "DECLINED"
            updates["customerCallInbox/$customerUid/customerAnswered"] = false
            updates["customerCallInbox/$customerUid/updatedAt"] = now
        }
        if (riderUid.isNotBlank()) {
            updates["riderCallInbox/$riderUid/status"] = "DECLINED"
            updates["riderCallInbox/$riderUid/customerAnswered"] = false
            updates["riderCallInbox/$riderUid/updatedAt"] = now
        }
        db.reference.updateChildren(updates)
    }

    private fun watchForRemoteCancellation() {
        val ref = db.getReference("inAppCalls/$orderId/status")
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val status = snapshot.getValue(String::class.java) ?: return
                if (status in listOf("ENDED", "DECLINED", "TIMEOUT", "FAILED")) {
                    stopRingtoneAndVibration()
                    CentralizedCallManager.onCallEnded()
                    finish()
                }
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        ref.addValueEventListener(listener)
        statusListener = listener
    }

    override fun onDestroy() {
        stopRingtoneAndVibration()
        statusListener?.let {
            db.getReference("inAppCalls/$orderId/status").removeEventListener(it)
        }
        super.onDestroy()
    }
}
