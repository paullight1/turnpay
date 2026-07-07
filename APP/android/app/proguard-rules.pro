# TrustPay release ProGuard/R8 rules.
# Referenced from android/app/build.gradle.kts (release buildType).

# Flutter engine + embedding.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-dontwarn io.flutter.embedding.**

# flutter_secure_storage — keep the plugin and its AndroidX Security backing
# classes so encrypted storage is not stripped/renamed by R8.
-keep class com.it_nomads.fluttersecurestorage.** { *; }
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# local_auth — keep the biometric plugin and AndroidX biometric prompt classes.
-keep class io.flutter.plugins.localauth.** { *; }
-keep class androidx.biometric.** { *; }
-keep class androidx.fragment.app.** { *; }
