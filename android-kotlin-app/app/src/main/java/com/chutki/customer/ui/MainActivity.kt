package com.chutki.customer.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.chutki.customer.ChutkiApplication
import com.chutki.customer.databinding.ActivityMainBinding
import com.chutki.customer.models.BazarOrder
import com.chutki.customer.models.BazarStore
import com.chutki.customer.models.SecurityAndGeoUtils
import com.chutki.customer.webrtc.CentralizedCallManager
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.ValueEventListener

/**
 * MainActivity:
 * - Real-time 5km GPS Store & Product Proximity Sorting
 * - Active Order Tracking with Delivery QR + 4-digit PIN
 * - "Call Rider (In-App)" and "Message Rider" buttons (enabled only when assigned rider + eligible status)
 * - Centralized Incoming Call Listener registration
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val db by lazy { ChutkiApplication.database }

    private var customerUid: String = "cust_demo_01"
    private var customerName: String = "Customer"
    private var currentOrder: BazarOrder? = null
    private var userLat: Double? = null
    private var userLng: Double? = null

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { perms ->
        if (perms[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            perms[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        ) {
            fetchExactGpsLocation()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        customerUid = intent.getStringExtra("customerUid") ?: "cust_demo_01"
        customerName = intent.getStringExtra("customerName") ?: "Rahul Sharma"

        requestNotificationPermissionIfNeeded()
        requestGpsLocation()
        observeStoresWith5KmPriority()
        observeActiveCustomerOrders()

        binding.btnRefreshGps.setOnClickListener {
            requestGpsLocation()
        }

        binding.btnCallRider.setOnClickListener {
            val order = currentOrder ?: return@setOnClickListener
            if (!order.isRiderCommunicationEligible()) {
                Toast.makeText(this, "Rider call is only available for active assigned deliveries.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val callIntent = Intent(this, ActiveCallActivity::class.java).apply {
                putExtra("isOutgoing", true)
                putExtra("orderId", order.id)
                putExtra("tripId", order.tripId.ifBlank { order.id })
                putExtra("riderUid", order.effectiveRiderUid())
                putExtra("riderName", order.effectiveRiderName())
                putExtra("riderPhoto", order.riderPhoto)
                putExtra("customerUid", customerUid)
                putExtra("customerLabel", "$customerName • #${order.id.takeLast(5).uppercase()}")
                putExtra("dropAddress", order.address)
            }
            startActivity(callIntent)
        }

        binding.btnMessageRider.setOnClickListener {
            val order = currentOrder ?: return@setOnClickListener
            if (!order.isRiderCommunicationEligible()) {
                Toast.makeText(this, "Rider chat is only available for active assigned deliveries.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val chatIntent = Intent(this, TripChatActivity::class.java).apply {
                putExtra("orderId", order.id)
                putExtra("tripId", order.tripId.ifBlank { order.id })
                putExtra("riderUid", order.effectiveRiderUid())
                putExtra("riderName", order.effectiveRiderName())
                putExtra("riderPhoto", order.riderPhoto)
                putExtra("customerUid", customerUid)
                putExtra("customerLabel", "$customerName • #${order.id.takeLast(5).uppercase()}")
                putExtra("dropAddress", order.address)
                putExtra("orderStatus", order.status)
            }
            startActivity(chatIntent)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 201)
            }
        }
    }

    private fun requestGpsLocation() {
        val fineGranted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (fineGranted) {
            fetchExactGpsLocation()
        } else {
            locationPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                )
            )
        }
    }

    @Suppress("MissingPermission")
    private fun fetchExactGpsLocation() {
        binding.tvGpsBanner.text = "Locating exact GPS coordinates (5km radius filter)..."
        val client = LocationServices.getFusedLocationProviderClient(this)
        client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
            .addOnSuccessListener { location ->
                if (location != null) {
                    userLat = location.latitude
                    userLng = location.longitude
                    binding.tvGpsBanner.text = String.format(
                        "Exact GPS Active (%.4f, %.4f) • ±%dm • Stores <= 5km prioritized first",
                        location.latitude,
                        location.longitude,
                        location.accuracy.toInt()
                    )
                    observeStoresWith5KmPriority()
                } else {
                    binding.tvGpsBanner.text = "GPS Signal Unavailable • Showing default store order"
                }
            }
    }

    private fun observeStoresWith5KmPriority() {
        db.getReference("stores").addValueEventListener(object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val rawStores = mutableListOf<BazarStore>()
                for (child in snapshot.children) {
                    val map = child.value as? Map<*, *> ?: continue
                    rawStores.add(
                        BazarStore(
                            id = child.key ?: "",
                            storeName = map["storeName"] as? String ?: "Chutki Store",
                            lat = (map["lat"] as? Number)?.toDouble(),
                            lng = (map["lng"] as? Number)?.toDouble(),
                            isApproved = map["isApproved"] as? Boolean ?: true,
                            status = map["status"] as? String ?: "active"
                        )
                    )
                }
                val sorted = SecurityAndGeoUtils.sortStoresBy5KmPriority(rawStores, userLat, userLng)
                val nearbyCount = sorted.count { it.isNearby5Km }
                binding.tvNearbySummary.text =
                    "Nearby Stores (<= 5 km): $nearbyCount / ${sorted.size} stores sorted to top"
            }

            override fun onCancelled(error: DatabaseError) {}
        })
    }

    private fun observeActiveCustomerOrders() {
        db.getReference("orders").addValueEventListener(object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val activeIds = mutableSetOf<String>()
                var selectedOrder: BazarOrder? = null

                for (child in snapshot.children) {
                    val map = child.value as? Map<*, *> ?: continue
                    val orderUserId = map["userId"] as? String ?: ""
                    if (orderUserId != customerUid && selectedOrder != null) continue

                    val order = BazarOrder(
                        id = child.key ?: "",
                        userId = orderUserId,
                        userName = map["userName"] as? String ?: customerName,
                        address = map["address"] as? String ?: "Gossaigaon Main Road",
                        status = map["status"] as? String ?: "pending",
                        total = (map["total"] as? Number)?.toDouble() ?: 0.0,
                        deliveryPin = map["deliveryPin"] as? String ?: "4829",
                        riderUid = map["riderUid"] as? String ?: "",
                        assignedRiderId = map["assignedRiderId"] as? String ?: "",
                        riderId = map["riderId"] as? String ?: "",
                        riderName = map["riderName"] as? String ?: (map["deliveryBoyName"] as? String ?: ""),
                        riderPhoto = map["riderPhoto"] as? String ?: "",
                        tripId = map["tripId"] as? String ?: (map["batchGroupId"] as? String ?: (child.key ?: ""))
                    )

                    if (order.status.lowercase() !in listOf("delivered", "completed", "cancelled", "rejected")) {
                        activeIds.add(order.id)
                    }

                    if (selectedOrder == null || order.isRiderCommunicationEligible()) {
                        selectedOrder = order
                    }
                }

                // Initialize App-Wide Incoming Call Listener for this customer and their active orders
                CentralizedCallManager.initForCustomer(
                    context = applicationContext,
                    customerUid = customerUid,
                    activeOrders = activeIds
                )

                currentOrder = selectedOrder
                bindOrderCard(selectedOrder)
            }

            override fun onCancelled(error: DatabaseError) {}
        })
    }

    private fun bindOrderCard(order: BazarOrder?) {
        if (order == null) {
            binding.cardActiveOrder.visibility = View.GONE
            return
        }
        binding.cardActiveOrder.visibility = View.VISIBLE
        binding.tvOrderId.text = "Order #${order.id.takeLast(6).uppercase()}"
        binding.tvOrderStatus.text = "Status: ${order.status.uppercase()}"
        binding.tvDeliveryPin.text = "Delivery Verification PIN: ${order.deliveryPin}"

        val eligible = order.isRiderCommunicationEligible()
        val isTerminal = order.status.lowercase() in listOf("cancelled", "completed", "delivered", "rejected")

        if (eligible && !isTerminal) {
            binding.layoutRiderComm.visibility = View.VISIBLE
            binding.tvRiderName.text = "${order.effectiveRiderName()} (Assigned Delivery Partner)"
            binding.btnCallRider.isEnabled = true
            binding.btnMessageRider.isEnabled = true
        } else if (isTerminal && order.effectiveRiderUid().isNotEmpty()) {
            binding.layoutRiderComm.visibility = View.VISIBLE
            binding.tvRiderName.text = "${order.effectiveRiderName()} • Order ${order.status}"
            binding.btnCallRider.isEnabled = false
            binding.btnMessageRider.isEnabled = false
        } else {
            binding.layoutRiderComm.visibility = View.GONE
        }
    }
}
