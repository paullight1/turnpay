import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/core/widgets/main_shell.dart';
import 'package:trustpay_app/core/state/wallet_refresh_signal.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets(
      'More tab opens services and keeps history available from its menu',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    final router = GoRouter(
      initialLocation: AppRoutes.home,
      routes: [
        GoRoute(
          path: AppRoutes.home,
          builder: (context, state) =>
              MainShell(homeDataService: bundle.homeDataService),
        ),
        GoRoute(
          path: AppRoutes.exchange,
          builder: (context, state) =>
              const Scaffold(body: Text('Immersive exchange')),
        ),
        GoRoute(
          path: AppRoutes.activity,
          builder: (context, state) => DashboardTransactionsScreen(
            homeDataService: bundle.homeDataService,
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp.router(routerConfig: router),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Home'), findsWidgets);
    expect(find.text('Exchange'), findsOneWidget);
    expect(find.text('More'), findsWidgets);
    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Top services'), findsOneWidget);

    await tester.tap(find.text('Exchange'));
    await tester.pumpAndSettle();

    expect(find.text('Immersive exchange'), findsOneWidget);
    expect(find.text('Home'), findsNothing);
    expect(find.text('History'), findsNothing);
    expect(find.text('Profile'), findsNothing);

    router.pop();
    await tester.pumpAndSettle();
    expect(find.text('Top services'), findsOneWidget);

    await tester.tap(find.text('More').last);
    await tester.pumpAndSettle();

    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Top services'), findsNothing);
    expect(find.text('ALL SERVICES'), findsOneWidget);
    expect(find.byKey(const ValueKey('feature-card-airtime')), findsOneWidget);
    expect(find.byKey(const ValueKey('feature-card-wallets')), findsOneWidget);
    expect(find.text('Transactions and exchanges'), findsNothing);
    expect(find.byTooltip('Back'), findsNothing);

    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('History'));
    await tester.pumpAndSettle();
    expect(find.text('Transactions and exchanges'), findsOneWidget);
    expect(find.text('Exchange history'), findsOneWidget);
    expect(
      bundle.adapter.requestedUris
          .where((uri) => uri.path == '/api/auth/bootstrap')
          .length,
      1,
      reason:
          'History should load transactions without reloading the dashboard',
    );

    router.pop();
    await tester.pumpAndSettle();
    expect(find.text('ALL SERVICES'), findsOneWidget);

    await tester.tap(find.text('Home').last);
    await tester.pumpAndSettle();
    expect(find.text('Top services'), findsOneWidget);
    expect(
      bundle.adapter.requestedUris
          .where((uri) => uri.path == '/api/auth/bootstrap')
          .length,
      1,
      reason: 'Returning Home should preserve its loaded dashboard',
    );

    walletRefreshSignal.bump();
    await tester.pumpAndSettle();
    expect(
      bundle.adapter.requestedUris
          .where((uri) => uri.path == '/api/auth/bootstrap')
          .length,
      2,
      reason: 'Money movement must still refresh balances on the retained Home',
    );

    final beforeProfile = bundle.adapter.requestedUris.length;
    await tester.tap(find.text('Profile').last);
    await tester.pumpAndSettle();

    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Account Details'), findsWidgets);
    expect(
      bundle.adapter.requestedUris.skip(beforeProfile).map((uri) => uri.path),
      ['/api/auth/bootstrap'],
      reason: 'Profile only needs the current user',
    );
    await tester.scrollUntilVisible(
      find.text('Help & Support'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Help & Support'), findsWidgets);
  });
}
