package com.trustpay.app

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.os.Build
import java.io.File

class MainActivity : FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "trustpay/device_integrity")
            .setMethodCallHandler { call, result ->
                if (call.method != "check") {
                    result.notImplemented()
                } else {
                    try {
                        val risky = Build.TAGS?.contains("test-keys") == true || listOf(
                            "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su",
                            "/data/adb/magisk", "/system/app/Superuser.apk"
                        ).any { File(it).exists() }
                        val emulator = Build.FINGERPRINT.startsWith("generic") || Build.MODEL.contains("sdk_gphone") || Build.MODEL.contains("Emulator")
                        result.success(if (risky) "risky" else if (emulator) "unavailable" else "clear")
                    } catch (_: Exception) { result.success("unavailable") }
                }
            }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Prevent balances/PINs from appearing in the app switcher (Recents)
        // and block screenshots/screen recording of sensitive fintech screens.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
    }
}
