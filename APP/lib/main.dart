import 'dart:async';

import 'package:flutter/material.dart';
import 'core/widgets/keyboard_visibility_guard.dart';
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
import 'core/widgets/startup_gate.dart';
import 'core/constants/app_constants.dart';
import 'services/secure_transport_factory.dart';

/// Crash-reporting DSN. Provide it at build time with
/// `--dart-define=SENTRY_DSN=...`. When empty, Sentry stays a
/// no-op and errors are only logged — the app still runs.
// The release workflow may supply this public reporting endpoint.
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

      // Force portrait orientation for mobile fintech apps (not on web)
      if (!kIsWeb) {
        await SystemChrome.setPreferredOrientations([
          DeviceOrientation.portraitUp,
          DeviceOrientation.portraitDown,
        ]);

        final brightness =
            WidgetsBinding.instance.platformDispatcher.platformBrightness;
        SystemChrome.setSystemUIOverlayStyle(_overlayStyle(brightness));

        SystemChrome.setEnabledSystemUIMode(
          SystemUiMode.edgeToEdge,
        );
      }

      runApp(
        ProviderScope(
          child: StartupGate(
            initialize: () async {
              final transport = SecureTransportConfiguration.fromEnvironment(
                  baseUrl: AppConstants.apiBaseUrl, releaseMode: kReleaseMode);
              final error = transport.releaseValidationError(
                  nativePinningSupported: !kIsWeb);
              if (error != null) throw StateError(error);
              // These services initialize independently; waiting for them in
              // sequence unnecessarily delays the first app frame.
              await Future.wait([
                _bootstrapCrashReporting(),
                _bootstrapSupabase(),
              ]);
            },
            onError: (error, stack) {
              if (_sentryDsn.isNotEmpty) {
                Sentry.captureException(error, stackTrace: stack);
              }
            },
            builder: (_) => const TrustPayApp(),
          ),
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
    options.environment = const String.fromEnvironment('SENTRY_ENVIRONMENT',
        defaultValue: kReleaseMode ? 'production' : 'development');
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
          SystemChrome.setSystemUIOverlayStyle(_overlayStyle(brightness));
        }

        return ColoredBox(
          color: Theme.of(context).scaffoldBackgroundColor,
          child: SafeArea(
            bottom: false,
            child: LayoutBuilder(
              builder: (context, constraints) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  size: Size(
                    constraints.maxWidth,
                    MediaQuery.sizeOf(context).height,
                  ),
                ),
                child: KeyboardVisibilityGuard(
                  child: AppLockGate(child: child ?? const SizedBox.shrink()),
                ),
              ),
            ),
          ),
        );
      },
      debugShowCheckedModeBanner: false,
    );
  }
}

SystemUiOverlayStyle _overlayStyle(Brightness brightness) {
  final icons =
      brightness == Brightness.light ? Brightness.dark : Brightness.light;
  return SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarBrightness: brightness,
    statusBarIconBrightness: icons,
    systemNavigationBarColor: Colors.transparent,
    systemNavigationBarIconBrightness: icons,
  );
}
