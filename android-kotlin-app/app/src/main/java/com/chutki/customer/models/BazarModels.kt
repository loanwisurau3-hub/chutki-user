package com.chutki.customer.models

import kotlin.math.*

data class Store(
    val storeId: String = "",
    val name: String = "",
    val cuisine: String = "",
    val isOpen: Boolean = true,
    val approved: Boolean = true,
    val suspended: Boolean = false,
    val lat: Double? = null,
    val lng: Double? = null,
    val ratingAvg: Double = 4.8
)

data class DeliveryPartner(
    val uid: String = "",
    val name: String = "Delivery Rider",
    val photoUrl: String? = null,
    val vehicle: String = "Bike",
    val online: Boolean = true,
    val lat: Double? = null,
    val lng: Double? = null,
    val ratingAvg: Double = 4.9
)

data class OrderRecord(
    val orderId: String = "",
    val batchGroupId: String? = null,
    val customerUid: String = "",
    val restaurantId: String = "",
    val deliveryUid: String? = null,
    val totalAmount: Double = 0.0,
    val address: String = "",
    val deliveryOtp: String = "",
    val deliveryQrToken: String = "",
    val status: String = "PLACED",
    val paymentMode: String = "COD",
    val createdAt: Long = 0L
) {
    val canonicalTripId: String
        get() = if (!batchGroupId.isNullOrBlank()) batchGroupId else orderId

    fun isRiderCommunicationEligible(): Boolean {
        if (deliveryUid.isNullOrBlank()) return false
        val normalized = status.trim().uppercase().replace(Regex("[\\s-]+"), "_")
        if (normalized == "DELIVERED" || normalized == "CANCELLED" || normalized == "PLACED") {
            return false
        }
        return normalized in setOf(
            "ACCEPTED_BY_RIDER",
            "ACCEPTED",
            "PICKED_UP",
            "READY_FOR_PICKUP",
            "OUT_FOR_DELIVERY",
            "PREPARING",
            "PACKING"
        )
    }
}

data class InAppCallRecord(
    val callId: String = "",
    val tripId: String = "",
    val orderId: String = "",
    val callerRole: String = "CUSTOMER",
    val riderUid: String = "",
    val riderName: String = "Delivery Rider",
    val riderPhotoUrl: String? = null,
    val customerUid: String = "",
    val customerLabel: String = "",
    val dropAddress: String = "",
    val status: String = "RINGING",
    val customerAnswered: Boolean = false,
    val isMuted: Boolean = false,
    val isOnHold: Boolean = false,
    val startedAt: Long = 0L,
    val connectedAt: Long = 0L,
    val updatedAt: Long = 0L
) {
    fun toFirebaseMap(): Map<String, Any?> = mapOf(
        "callId" to callId,
        "tripId" to tripId,
        "orderId" to orderId,
        "callerRole" to callerRole,
        "riderUid" to riderUid,
        "riderName" to riderName,
        "riderPhotoUrl" to riderPhotoUrl,
        "customerUid" to customerUid,
        "customerLabel" to customerLabel,
        "dropAddress" to dropAddress,
        "status" to status,
        "customerAnswered" to customerAnswered,
        "isMuted" to isMuted,
        "isOnHold" to isOnHold,
        "startedAt" to startedAt,
        "updatedAt" to updatedAt
    )
}

data class TripChatMessage(
    val messageId: String = "",
    val senderUid: String = "",
    val senderRole: String = "CUSTOMER",
    val receiverUid: String = "",
    val messageType: String = "TEXT",
    val message: String = "",
    val timestamp: Long = 0L,
    val status: String = "SENT"
) {
    fun toFirebaseMap(): Map<String, Any> = mapOf(
        "messageId" to messageId,
        "senderUid" to senderUid,
        "senderRole" to senderRole,
        "receiverUid" to receiverUid,
        "messageType" to messageType,
        "message" to message,
        "timestamp" to timestamp,
        "status" to status
    )
}

object ChutkiGeoAndPrivacyUtils {
    private val PHONE_REGEX = Regex("(?:\+91[\\s-]?|\\b91[\\s-]?|\\b)[6-9]\\d{9}\\b")
    private val PHISHING_URL_REGEX = Regex("(https?://|www\\.|bit\\.ly/|tinyurl\\.com/|t\\.me/|wa\\.me/)", RegexOption.IGNORE_CASE)

    fun maskPhoneNumbers(text: String): String {
        return PHONE_REGEX.replace(text, "[Phone Hidden]")
    }

    fun isSafeChatMessage(text: String): Boolean {
        val clean = text.trim()
        if (clean.isEmpty() || clean.length > 500) return false
        return !PHISHING_URL_REGEX.containsMatchIn(clean)
    }

    fun calculateDistanceKm(lat1: Double?, lon1: Double?, lat2: Double?, lon2: Double?): Double? {
        if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null
        val r = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2.0) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2.0)
        return r * (2 * atan2(sqrt(a), sqrt(1 - a)))
    }

    /**
     * Prioritizes stores within 5km of the customer's live GPS coordinates at the top of Home & Search.
     */
    fun sortStoresWithinRadiusFirst(
        stores: List<Store>,
        customerLat: Double?,
        customerLng: Double?,
        radiusKm: Double = 5.0
    ): List<Store> {
        return stores.sortedWith(compareBy<Store> { store ->
            val dist = calculateDistanceKm(customerLat, customerLng, store.lat, store.lng)
            val within = dist != null && dist <= radiusKm
            when {
                within && store.isOpen -> 0
                within && !store.isOpen -> 1
                dist != null && store.isOpen -> 2
                store.isOpen -> 3
                else -> 4
            }
        }.thenBy { store ->
            calculateDistanceKm(customerLat, customerLng, store.lat, store.lng) ?: Double.MAX_VALUE
        })
    }
}
