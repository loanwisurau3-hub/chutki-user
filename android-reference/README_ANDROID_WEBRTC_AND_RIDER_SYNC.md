# Chutki Customer & Rider App – Android Native WebRTC & Firebase Signaling Reference

This directory contains the native Android (Java + XML + Gradle + Manifest + FCM) implementation and Rider App WebRTC signaling compatibility layer that pairs with the Chutki Customer App over Firebase Realtime Database (`https://test-2a0d0-default-rtdb.firebaseio.com`).

---

## 1. Gradle Dependencies (`app/build.gradle`)

```groovy
dependencies {
    // WebRTC official Google / Stream prebuilt Android library (Opus audio + ICE/STUN/TURN)
    implementation 'io.getstream:stream-webrtc-android:1.1.3'

    // Firebase Realtime Database, Auth & Cloud Messaging
    implementation platform('com.google.firebase:firebase-bom:33.5.1')
    implementation 'com.google.firebase:firebase-database'
    implementation 'com.google.firebase:firebase-auth'
    implementation 'com.google.firebase:firebase-messaging'
}
```

---

## 2. Android Permissions & Service Declarations (`AndroidManifest.xml`)

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.chutki.customer">

    <!-- Required only for VoIP Audio, Network, Vibration & Call Notifications (NO CAMERA PERMISSION) -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />

    <application ...>
        <activity
            android:name=".voip.IncomingCallActivity"
            android:launchMode="singleTop"
            android:showOnLockScreen="true"
            android:turnScreenOn="true"
            android:exported="false" />

        <activity
            android:name=".voip.ActiveCallActivity"
            android:launchMode="singleTop"
            android:exported="false" />

        <activity
            android:name=".chat.TripChatActivity"
            android:windowSoftInputMode="adjustResize"
            android:exported="false" />

        <service
            android:name=".voip.CallForegroundService"
            android:foregroundServiceType="microphone|phoneCall"
            android:exported="false" />

        <service
            android:name=".voip.ChutkiCallMessagingService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
    </application>
</manifest>
```

---

## 3. Centralized Incoming Call Listener & WebRTC Engine (`WebRtcVoiceCallManager.java`)

```java
package com.chutki.customer.voip;

import android.content.Context;
import android.media.AudioManager;
import androidx.annotation.NonNull;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.*;
import org.webrtc.*;
import java.util.*;

public class WebRtcVoiceCallManager {
    private static WebRtcVoiceCallManager instance;
    private final DatabaseReference rootRef = FirebaseDatabase.getInstance().getReference();
    private final Set<String> handledCallIds = new HashSet<>();
    private PeerConnectionFactory factory;
    private PeerConnection peerConnection;
    private AudioTrack localAudioTrack;
    private AudioSource audioSource;
    private String activeCallId = null;

    public static synchronized WebRtcVoiceCallManager getInstance(Context ctx) {
        if (instance == null) {
            instance = new WebRtcVoiceCallManager(ctx.getApplicationContext());
        }
        return instance;
    }

    private WebRtcVoiceCallManager(Context appContext) {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext)
                .createInitializationOptions()
        );
        factory = PeerConnectionFactory.builder().createPeerConnectionFactory();
    }

    public void startCentralizedInboxListener(Context appContext, Set<String> activeOrderIds) {
        String uid = FirebaseAuth.getInstance().getUid();
        if (uid == null) return;

        rootRef.child("customerCallInbox").child(uid).addValueEventListener(new ValueEventListener() {
            @Override
            public void onDataChange(@NonNull DataSnapshot snapshot) {
                if (!snapshot.exists()) return;
                String callId = snapshot.child("callId").getValue(String.class);
                String status = snapshot.child("status").getValue(String.class);
                String callerRole = snapshot.child("callerRole").getValue(String.class);
                String customerUid = snapshot.child("customerUid").getValue(String.class);
                String orderId = snapshot.child("orderId").getValue(String.class);
                Long updatedAt = snapshot.child("updatedAt").getValue(Long.class);

                if (callId == null || orderId == null || updatedAt == null) return;
                if (!"RINGING".equals(status) || !"RIDER".equals(callerRole)) return;
                if (!uid.equals(customerUid)) return;
                if (!activeOrderIds.contains(orderId)) return;
                if (System.currentTimeMillis() - updatedAt > 60_000L) return;
                if (handledCallIds.contains(callId)) return;

                handledCallIds.add(callId);
                if (activeCallId != null && !activeCallId.equals(callId)) {
                    Map<String, Object> busy = new HashMap<>();
                    busy.put("inAppCalls/" + orderId + "/status", "BUSY");
                    busy.put("customerCallInbox/" + uid + "/status", "BUSY");
                    rootRef.updateChildren(busy);
                    return;
                }
                activeCallId = callId;
                IncomingCallActivity.launch(appContext, orderId, callId);
            }

            @Override
            public void onCancelled(@NonNull DatabaseError error) {}
        });
    }

    public void setMicrophoneMuted(boolean muted) {
        if (localAudioTrack != null) {
            localAudioTrack.setEnabled(!muted);
        }
    }

    public void setSpeakerphoneOn(Context context, boolean speakerOn) {
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(speakerOn);
        }
    }
}
```

---

## 4. TURN Server Production Setup (`coturn`)

A STUN-only configuration works on direct/symmetric Wi-Fi networks, but Carrier-Grade NAT (CGNAT) on mobile 4G/5G networks requires a TURN relay server:

1. Provision an Ubuntu VM with UDP/TCP ports `3478` and `5349` open.
2. Install `coturn` (`sudo apt install coturn`) and configure `/etc/turnserver.conf`:
   ```ini
   listening-port=3478
   tls-listening-port=5349
   fingerprint
   use-auth-secret
   static-auth-secret=YOUR_PRIVATE_HMAC_SECRET
   realm=turn.chutki.app
   total-quota=100
   no-multicast-peers
   ```
3. Generate short-lived HMAC-SHA1 ephemeral credentials on your backend or pass them via environment variables (`VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`). Never store plaintext long-term TURN passwords in public RTDB nodes.
