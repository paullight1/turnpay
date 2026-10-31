import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/features/auth/screens/onboarding_screen.dart';
import 'package:trustpay_app/features/auth/screens/splash_screen.dart';
import 'package:trustpay_app/core/widgets/main_shell.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets('default splash leaves as soon as session restoration completes',
      (tester) async {
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(MaterialApp.router(
      routerConfig: GoRouter(initialLocation: AppRoutes.splash, routes: [
        GoRoute(
          path: AppRoutes.splash,
          builder: (_, __) => SplashScreen(authService: bundle.authService),
        ),
        GoRoute(
          path: AppRoutes.onboarding,
          builder: (_, __) => const Scaffold(body: Text('Ready to sign in')),
        ),
      ]),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();
    expect(find.text('Ready to sign in'), findsOneWidget);
  });

  testWidgets('splash routes to home when a session is restored',
      (tester) async {
    final bundle = buildTrustPayTestBundle(refreshSucceeds: true);

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.splash,
          routes: [
            GoRoute(
              path: AppRoutes.splash,
              builder: (context, state) => SplashScreen(
                authService: bundle.authService,
                minimumDelay: Duration.zero,
              ),
            ),
            GoRoute(
              path: AppRoutes.home,
              builder: (context, state) =>
                  MainShell(homeDataService: bundle.homeDataService),
            ),
            GoRoute(
              path: AppRoutes.onboarding,
              builder: (context, state) => const OnboardingScreen(),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.textContaining('Good '), findsOneWidget);
    expect(find.text('Top services'), findsOneWidget);
  });

  testWidgets('splash routes to onboarding when the session is missing',
      (tester) async {
    final bundle = buildTrustPayTestBundle(refreshSucceeds: false);

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.splash,
          routes: [
            GoRoute(
              path: AppRoutes.splash,
              builder: (context, state) => SplashScreen(
                authService: bundle.authService,
                minimumDelay: Duration.zero,
              ),
            ),
            GoRoute(
              path: AppRoutes.home,
              builder: (context, state) =>
                  MainShell(homeDataService: bundle.homeDataService),
            ),
            GoRoute(
              path: AppRoutes.onboarding,
              builder: (context, state) => const OnboardingScreen(),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.textContaining('Send money'), findsWidgets);
    expect(find.text('SKIP'), findsOneWidget);
  });

  testWidgets('onboarding advances between slides', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: OnboardingScreen(),
      ),
    );

    await tester.pump();

    expect(find.textContaining('Send money'), findsWidgets);
    expect(find.text('SKIP'), findsOneWidget);

    await tester.drag(find.byType(PageView), const Offset(-420, 0));
    await tester.pump(const Duration(milliseconds: 600));

    expect(find.textContaining('Swap cedis to naira'), findsWidgets);
  });
}
