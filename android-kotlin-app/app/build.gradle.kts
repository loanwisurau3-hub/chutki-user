plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.chutki.customer"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.chutki.customer"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField(
            "String",
            "FIREBASE_DB_URL",
            "\"https://test-2a0d0-default-rtdb.firebaseio.com\""
        )
        // Optional TURN server config injected via gradle.properties or CI env
        buildConfigField("String", "TURN_URL", "\"${project.findProperty("TURN_URL") ?: ""}\"")
        buildConfigField("String", "TURN_USERNAME", "\"${project.findProperty("TURN_USERNAME") ?: ""}\"")
        buildConfigField("String", "TURN_CREDENTIAL", "\"${project.findProperty("TURN_CREDENTIAL") ?: ""}\"")
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")

    // Firebase BOM (Realtime Database, Auth, Cloud Messaging)
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-database-ktx")
    implementation("com.google.firebase:firebase-auth-ktx")
    implementation("com.google.firebase:firebase-messaging-ktx")

    // Google Play Services Location (for 5km real-time GPS proximity sorting)
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // Official WebRTC Android SDK (Opus voice, STUN/TURN, ICE candidate negotiation)
    implementation("io.getstream:stream-webrtc-android:1.1.3")

    // ZXing for offline Delivery QR Code generation alongside 4-digit PIN
    implementation("com.google.zxing:core:3.5.3")

    // Coil for loading Rider / Store images
    implementation("io.coil-kt:coil:2.7.0")
}
