import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart' show kIsWeb, kReleaseMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/config/supabase_config.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_controller.dart';
import 'core/router/app_router.dart';
import 'core/widgets/app_lock_gate.dart';

/// Crash-reporting DSN. Provide it at build time with
/// `--dart-define=SENTRY_DSN=...`. When empty (debug/dev), Sentry stays a
/// no-op and errors are only logged — the app still runs.
// TODO(launch): supply the production SENTRY_DSN via the CI/build pipeline.
const _sentryDsn = String.fromEnvironment('SENTRY_DSN');

void main() {
  // Route both Flutter framework errors and uncaught async errors to crash
  // reporting (Sentry when a DSN is configured, otherwise just logged).
  runZonedGuarded<void>(
    () async {
      WidgetsFlutterBinding.ensureInitialized();

      FlutterError.onError = (details) {
        FlutterError.presentError(details);
        if (_sentryDsn.isNotEmpty) {
          Sentry.captureException(
            details.exception,
            stackTrace: details.stack,
          );
        }
      };

      await _bootstrapCrashReporting();
      await _bootstrapSupabase();

      // Force portrait orientation for mobile fintech apps (not on web)
      if (!kIsWeb) {
        await SystemChrome.setPreferredOrientations([
          DeviceOrientation.portraitUp,
          DeviceOrientation.portraitDown,
        ]);

        // Enable edge-to-edge display for immersive design
        SystemChrome.setSystemUIOverlayStyle(
          const SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            statusBarIconBrightness: Brightness.light,
            systemNavigationBarColor: Colors.transparent,
            systemNavigationBarIconBrightness: Brightness.light,
          ),
        );

        SystemChrome.setEnabledSystemUIMode(
          SystemUiMode.edgeToEdge,
        );
      }

      runApp(
        const ProviderScope(
          child: TrustPayApp(),
        ),
      );
    },
    (error, stack) {
      if (_sentryDsn.isNotEmpty) {
        Sentry.captureException(error, stackTrace: stack);
      } else {
        FlutterError.presentError(
          FlutterErrorDetails(exception: error, stack: stack),
        );
      }
    },
  );
}

Future<void> _bootstrapCrashReporting() async {
  if (_sentryDsn.isEmpty) {
    // No DSN configured — leave Sentry uninitialized so it stays a no-op.
    return;
  }

  await SentryFlutter.init((options) {
    options.dsn = _sentryDsn;
    options.environment = kReleaseMode ? 'production' : 'development';
    // Keep PII out of crash reports for a fintech app.
    options.sendDefaultPii = false;
  });
}

Future<void> _bootstrapSupabase() async {
  if (SupabaseConfig.isConfigured) {
    await Supabase.initialize(
      url: SupabaseConfig.url,
      publishableKey: SupabaseConfig.publishableKey,
    );
    return;
  }

  if (kReleaseMode) {
    throw StateError(
      'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required in release builds.',
    );
  }
}

class TrustPayApp extends ConsumerWidget {
  const TrustPayApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    final themeMode = ref.watch(themeModeProvider);

    return MaterialApp.router(
      title: 'TrustPay',
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: themeMode,
      routerConfig: router,
      builder: (context, child) {
        // Resolve the *effective* brightness here (inside MaterialApp) so that
        // ThemeMode.system follows the device and reactively rebuilds when the
        // OS theme changes. AppColors must be updated before the subtree builds.
        final brightness = Theme.of(context).brightness;
        AppColors.applyBrightness(brightness);

        if (!kIsWeb) {
          final isLight = brightness == Brightness.light;
          SystemChrome.setSystemUIOverlayStyle(
            SystemUiOverlayStyle(
              statusBarColor: Colors.transparent,
              statusBarIconBrightness:
                  isLight ? Brightness.dark : Brightness.light,
              systemNavigationBarColor: Colors.transparent,
              systemNavigationBarIconBrightness:
                  isLight ? Brightness.dark : Brightness.light,
            ),
          );
        }

        return AppLockGate(child: child ?? const SizedBox.shrink());
      },
      debugShowCheckedModeBanner: false,
    );
  }
}
