package com.chutki.customer.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.chutki.customer.ChutkiApplication
import com.chutki.customer.R
import com.chutki.customer.databinding.ActivityTripChatBinding
import com.chutki.customer.models.SecurityAndGeoUtils
import com.chutki.customer.models.TripChatMessage
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.ValueEventListener
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * TripChatActivity:
 * Real-time WhatsApp-style Customer <-> Rider Chat on `tripChats/{orderId}/messages`
 * - Uses Firebase push IDs
 * - Customer messages on right, Rider messages on left
 * - Automatic READ receipt updates for Rider messages
 * - Retry failed messages on tap
 * - Masks any accidentally typed phone numbers so customer & rider numbers are never exposed
 * - Includes direct In-App Call button in the chat header
 */
class TripChatActivity : AppCompatActivity() {

    private lateinit var binding: ActivityTripChatBinding
    private val db by lazy { ChutkiApplication.database }

    private var orderId: String = ""
    private var tripId: String = ""
    private var riderUid: String = ""
    private var riderName: String = "Delivery Partner"
    private var riderPhoto: String = ""
    private var customerUid: String = ""
    private var customerLabel: String = ""
    private var dropAddress: String = ""
    private var orderStatus: String = "out_for_delivery"

    private val messages = mutableListOf<TripChatMessage>()
    private lateinit var adapter: ChatAdapter
    private var messagesListener: ValueEventListener? = null
    private var presenceListener: ValueEventListener? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityTripChatBinding.inflate(layoutInflater)
        setContentView(binding.root)

        orderId = intent.getStringExtra("orderId") ?: ""
        tripId = intent.getStringExtra("tripId") ?: orderId
        riderUid = intent.getStringExtra("riderUid") ?: ""
        riderName = intent.getStringExtra("riderName") ?: "Delivery Partner"
        riderPhoto = intent.getStringExtra("riderPhoto") ?: ""
        customerUid = intent.getStringExtra("customerUid") ?: "cust_demo_01"
        customerLabel = intent.getStringExtra("customerLabel") ?: "Customer"
        dropAddress = intent.getStringExtra("dropAddress") ?: ""
        orderStatus = intent.getStringExtra("orderStatus") ?: "out_for_delivery"

        binding.tvChatRiderName.text = riderName
        binding.tvChatPresence.text = "Order #${orderId.takeLast(6).uppercase()} • Phone Hidden"

        adapter = ChatAdapter(customerUid) { failedMsg ->
            retrySendMessage(failedMsg)
        }
        binding.rvMessages.layoutManager = LinearLayoutManager(this).apply {
            stackFromEnd = true
        }
        binding.rvMessages.adapter = adapter

        binding.btnBackChat.setOnClickListener { finish() }

        binding.btnHeaderVoiceCall.setOnClickListener {
            if (!isOrderCommunicationAllowed()) {
                Toast.makeText(this, "Order completed/cancelled. Calling disabled.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val callIntent = Intent(this, ActiveCallActivity::class.java).apply {
                putExtra("isOutgoing", true)
                putExtra("orderId", orderId)
                putExtra("tripId", tripId)
                putExtra("riderUid", riderUid)
                putExtra("riderName", riderName)
                putExtra("riderPhoto", riderPhoto)
                putExtra("customerUid", customerUid)
                putExtra("customerLabel", customerLabel)
                putExtra("dropAddress", dropAddress)
            }
            startActivity(callIntent)
        }

        binding.btnSendMessage.setOnClickListener {
            sendCustomerMessage()
        }

        observeRiderPresence()
        observeTripMessages()
    }

    private fun isOrderCommunicationAllowed(): Boolean {
        val norm = orderStatus.trim().lowercase()
        return riderUid.isNotBlank() && norm in setOf(
            "accepted_by_rider",
            "picked_up",
            "out_for_delivery"
        )
    }

    private fun observeRiderPresence() {
        if (riderUid.isBlank()) return
        val ref = db.getReference("riders/$riderUid/isOnline")
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val online = snapshot.getValue(Boolean::class.java)
                binding.tvChatPresence.text = when (online) {
                    true -> "Online • Order #${orderId.takeLast(6).uppercase()}"
                    false -> "Offline • Order #${orderId.takeLast(6).uppercase()}"
                    null -> "Assigned Rider • Order #${orderId.takeLast(6).uppercase()}"
                }
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        ref.addValueEventListener(listener)
        presenceListener = listener
    }

    private fun observeTripMessages() {
        val ref = db.getReference("tripChats/$orderId/messages")
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val loaded = mutableListOf<TripChatMessage>()
                val readUpdates = mutableMapOf<String, Any?>()

                for (child in snapshot.children) {
                    val map = child.value as? Map<*, *> ?: continue
                    val msgId = map["messageId"] as? String ?: child.key ?: continue
                    val senderUid = map["senderUid"] as? String ?: ""
                    val senderRole = map["senderRole"] as? String ?: "CUSTOMER"
                    val receiverUid = map["receiverUid"] as? String ?: ""
                    val messageText = map["message"] as? String ?: ""
                    val ts = (map["timestamp"] as? Number)?.toLong() ?: 0L
                    val status = map["status"] as? String ?: "SENT"

                    val msg = TripChatMessage(
                        messageId = msgId,
                        senderUid = senderUid,
                        senderRole = senderRole,
                        receiverUid = receiverUid,
                        messageType = map["messageType"] as? String ?: "TEXT",
                        message = SecurityAndGeoUtils.maskPhoneNumbers(messageText),
                        timestamp = ts,
                        status = status
                    )
                    loaded.add(msg)

                    // Mark Rider messages as READ automatically when Customer views chat
                    if (senderRole == "RIDER" && status != "READ") {
                        readUpdates["$msgId/status"] = "READ"
                    }
                }

                if (readUpdates.isNotEmpty()) {
                    ref.updateChildren(readUpdates)
                }

                loaded.sortBy { it.timestamp }
                messages.clear()
                messages.addAll(loaded)
                adapter.submitList(messages.toList())

                binding.tvEmptyChat.visibility = if (messages.isEmpty()) View.VISIBLE else View.GONE
                if (messages.isNotEmpty()) {
                    binding.rvMessages.scrollToPosition(messages.size - 1)
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Toast.makeText(
                    this@TripChatActivity,
                    "Chat sync error: ${error.message}",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
        ref.addValueEventListener(listener)
        messagesListener = listener
    }

    private fun sendCustomerMessage() {
        if (!isOrderCommunicationAllowed()) {
            Toast.makeText(this, "Cannot send messages to inactive or unassigned orders.", Toast.LENGTH_SHORT).show()
            return
        }
        val rawText = binding.etMessageInput.text?.toString()?.trim() ?: ""
        if (rawText.isEmpty()) return

        val sanitized = SecurityAndGeoUtils.maskPhoneNumbers(
            SecurityAndGeoUtils.sanitizeInput(rawText, 500)
        )
        val pushRef = db.getReference("tripChats/$orderId/messages").push()
        val messageId = pushRef.key ?: "msg_${System.currentTimeMillis()}"

        val newMsg = TripChatMessage(
            messageId = messageId,
            senderUid = customerUid,
            senderRole = "CUSTOMER",
            receiverUid = riderUid,
            messageType = "TEXT",
            message = sanitized,
            timestamp = System.currentTimeMillis(),
            status = "SENT"
        )

        binding.etMessageInput.setText("")
        pushRef.setValue(newMsg.toMap()).addOnFailureListener {
            val failedCopy = newMsg.copy(status = "FAILED")
            messages.add(failedCopy)
            adapter.submitList(messages.toList())
            Toast.makeText(this, "Network error. Tap failed message to retry.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun retrySendMessage(failedMsg: TripChatMessage) {
        val ref = db.getReference("tripChats/$orderId/messages/${failedMsg.messageId}")
        val retryPayload = failedMsg.copy(
            status = "SENT",
            timestamp = System.currentTimeMillis()
        )
        ref.setValue(retryPayload.toMap())
    }

    override fun onDestroy() {
        messagesListener?.let {
            db.getReference("tripChats/$orderId/messages").removeEventListener(it)
        }
        if (riderUid.isNotBlank()) {
            presenceListener?.let {
                db.getReference("riders/$riderUid/isOnline").removeEventListener(it)
            }
        }
        super.onDestroy()
    }

    private class ChatAdapter(
        private val currentCustomerUid: String,
        private val onRetryClick: (TripChatMessage) -> Unit
    ) : RecyclerView.Adapter<ChatAdapter.MessageViewHolder>() {

        private var items: List<TripChatMessage> = emptyList()
        private val timeFormat = SimpleDateFormat("hh:mm a", Locale.getDefault())

        fun submitList(newItems: List<TripChatMessage>) {
            items = newItems
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_chat_message, parent, false)
            return MessageViewHolder(view)
        }

        override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
            holder.bind(items[position], currentCustomerUid, timeFormat, onRetryClick)
        }

        override fun getItemCount(): Int = items.size

        class MessageViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
            private val tvBubbleLeft: TextView = itemView.findViewById(R.id.tvBubbleLeft)
            private val tvBubbleRight: TextView = itemView.findViewById(R.id.tvBubbleRight)

            fun bind(
                msg: TripChatMessage,
                customerUid: String,
                formatter: SimpleDateFormat,
                onRetryClick: (TripChatMessage) -> Unit
            ) {
                val isCustomer = msg.senderRole == "CUSTOMER" || msg.senderUid == customerUid
                val timeStr = formatter.format(Date(msg.timestamp))
                if (isCustomer) {
                    tvBubbleLeft.visibility = View.GONE
                    tvBubbleRight.visibility = View.VISIBLE
                    val tick = when (msg.status) {
                        "READ" -> "✓✓ Read"
                        "DELIVERED" -> "✓✓"
                        "FAILED" -> "⚠ Tap to Retry"
                        else -> "✓"
                    }
                    tvBubbleRight.text = "${msg.message}\n$timeStr • $tick"
                    tvBubbleRight.setOnClickListener {
                        if (msg.status == "FAILED") onRetryClick(msg)
                    }
                } else {
                    tvBubbleRight.visibility = View.GONE
                    tvBubbleLeft.visibility = View.VISIBLE
                    tvBubbleLeft.text = "${msg.message}\n$timeStr"
                }
            }
        }
    }
}
