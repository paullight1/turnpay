package com.trustpay.app

import android.os.Bundle
import android.view.WindowManager
import android.content.pm.ApplicationInfo
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
                        val risky = isPotentiallyCompromisedBuild()
                        val emulator = isEmulatorBuild()
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

    /**
     * Local signals are deliberately conservative heuristics. They are useful
     * for refusing a sensitive request when the app can see an obvious debug,
     * test-key, emulator, or root marker, but they are not Play Integrity and
     * must never be treated as proof by the server.
     */
    private fun isPotentiallyCompromisedBuild(): Boolean {
        val tags = Build.TAGS.orEmpty()
        if (tags.split(',').any { it.trim() == "test-keys" || it.trim() == "dev-keys" }) {
            return true
        }

        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            return true
        }

        return listOf(
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/su/bin/su",
            "/data/local/su",
            "/data/local/bin/su",
            "/data/local/xbin/su",
            "/system/app/Superuser.apk",
            "/system/bin/.ext/.su",
            "/system/usr/we-need-root/su",
            "/data/adb/magisk",
            "/data/adb/ksu",
        ).any { File(it).exists() }
    }

    private fun isEmulatorBuild(): Boolean {
        val fingerprint = Build.FINGERPRINT.orEmpty().lowercase()
        val model = Build.MODEL.orEmpty().lowercase()
        val manufacturer = Build.MANUFACTURER.orEmpty().lowercase()
        val brand = Build.BRAND.orEmpty().lowercase()
        val device = Build.DEVICE.orEmpty().lowercase()
        val product = Build.PRODUCT.orEmpty().lowercase()

        return fingerprint.startsWith("generic") ||
            fingerprint.contains("unknown") ||
            model.contains("emulator") ||
            model.contains("android sdk built for") ||
            manufacturer.contains("genymotion") ||
            (brand.startsWith("generic") && device.startsWith("generic")) ||
            product.contains("sdk") ||
            product.contains("emulator")
    }
}
