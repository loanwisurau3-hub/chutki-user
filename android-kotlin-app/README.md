# Chutki Customer App — Native Kotlin + Android SDK

Complete Native Android project written in **Kotlin** using the **Android SDK**, **WebRTC (`io.getstream:stream-webrtc-android`)**, and **Firebase Realtime Database (`https://test-2a0d0-default-rtdb.firebaseio.com`)**.

## Key Features Included
1. **Order Tracking Call & Message Rider Buttons (`MainActivity.kt`)**
   - Displayed only when an order has an assigned rider (`riderUid` / `assignedRiderId` / `riderId`) AND status is `accepted_by_rider`, `picked_up`, or `out_for_delivery`.
   - Automatically disabled when an order is `cancelled` or `completed`/`delivered`.
   - Zero phone-number exposure (neither Customer nor Rider phone numbers are ever displayed or dialled).

2. **Real-Time Firebase Signaling & Chat Paths**
   - `inAppCalls/{orderId}` & `inAppCalls/{orderId}/webrtc` (`offer`, `answer`, `callerCandidates`, `receiverCandidates`)
   - `customerCallInbox/{customerUid}`
   - `riderCallInbox/{riderUid}`
   - `tripChats/{orderId}/messages`

3. **Genuine Two-Way WebRTC Voice Calling (`WebRtcVoiceCallEngine.kt`, `ActiveCallActivity.kt`, `IncomingCallActivity.kt`)**
   - Audio-only WebRTC `PeerConnection` with Opus audio track and hardware Acoustic Echo Cancellation + Noise Suppression.
   - Queues remote ICE candidates arriving before `setRemoteDescription` completes.
   - Writes `status = "CONNECTED"` and `customerAnswered = true` **only after** `PeerConnection.PeerConnectionState.CONNECTED` is reached.
   - Real call duration timer computed strictly from actual `connectedAt` timestamp.
   - Real microphone track mute (`localAudioTrack.setEnabled(!muted)`) and Android `AudioManager.isSpeakerphoneOn` routing.
   - 60-second unanswered ringing timeout based on actual timestamps.

4. **App-Wide Incoming Call Manager & Background Service (`CentralizedCallManager.kt`, `CallForegroundService.kt`, `ChutkiFcmService.kt`)**
   - Single centralized listener watching `customerCallInbox/{customerUid}` and active `inAppCalls/{orderId}` nodes.
   - Deduplicates handled `callId`s, responds with `BUSY` if already on another call, and launches `IncomingCallActivity` with ringtone and vibration.
   - Includes `CallForegroundService` (`foregroundServiceType="phoneCall|microphone"`) and `ChutkiFcmService` for background wake-up.

5. **WhatsApp-Style Real-Time Chat (`TripChatActivity.kt`)**
   - Uses Firebase Push IDs on `tripChats/{orderId}/messages`.
   - Customer messages on the right, Rider messages on the left, live delivery/read receipts (`SENT`, `DELIVERED`, `READ`), failed message retry, and phone-number masking.

6. **Exact 5km GPS Store & Product Priority (`SecurityAndGeoUtils.kt`, `MainActivity.kt`)**
   - Uses `FusedLocationProviderClient` (`PRIORITY_HIGH_ACCURACY`) + Haversine distance to prioritize stores within `<= 5.0 km` at the top.
