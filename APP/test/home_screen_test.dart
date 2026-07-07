import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';
import 'package:trustpay_app/features/home/screens/home_screen.dart';
import 'package:trustpay_app/features/home/screens/home_task_screen.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets('home screen shows balances and hides them on toggle',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.home,
          routes: [
            GoRoute(
              path: AppRoutes.home,
              builder: (context, state) =>
                  HomeScreen(homeDataService: bundle.homeDataService),
            ),
            GoRoute(
              path: AppRoutes.activity,
              builder: (context, state) => DashboardDetailScreen(
                kind: DashboardDetailKind.activity,
                homeDataService: bundle.homeDataService,
              ),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Top services'), findsOneWidget);
    expect(find.text('Ada Lovelace'), findsWidgets);
    expect(find.text('Other wallets'), findsOneWidget);
    expect(find.text('Recent transactions'), findsOneWidget);
    expect(find.text('Fund success'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.visibility_outlined).first);
    await tester.pumpAndSettle();

    expect(find.text('******'), findsWidgets);

    await tester.tap(find.text('View more'));
    await tester.pumpAndSettle();

    expect(find.text('History'), findsOneWidget);
  });

  testWidgets('home screen opens the feature hub from quick actions',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.home,
          routes: [
            GoRoute(
              path: AppRoutes.home,
              builder: (context, state) =>
                  HomeScreen(homeDataService: bundle.homeDataService),
            ),
            GoRoute(
              path: AppRoutes.more,
              builder: (context, state) => const HomeTaskScreen(),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.text('More'));
    await tester.pumpAndSettle();

    expect(find.text('Feature hub'), findsOneWidget);
    expect(find.text('Explore features'), findsOneWidget);
    expect(find.text('Fund wallet'), findsOneWidget);
    expect(find.text('Virtual cards'), findsOneWidget);
    expect(find.text('Coming soon'), findsOneWidget);
  });

  testWidgets('home screen opens the funding workflow from the feature hub',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.home,
          routes: [
            GoRoute(
              path: AppRoutes.home,
              builder: (context, state) =>
                  HomeScreen(homeDataService: bundle.homeDataService),
            ),
            GoRoute(
              path: AppRoutes.more,
              builder: (context, state) => const HomeTaskScreen(),
            ),
            GoRoute(
              path: AppRoutes.fund,
              builder: (context, state) => MoneyActionScreen(
                kind: MoneyActionKind.fund,
                apiClient: bundle.apiClient,
              ),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.text('More'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Fund wallet'));
    await tester.pumpAndSettle();

    expect(find.text('Add money'), findsOneWidget);
    expect(find.text('Copy account number'), findsOneWidget);
    expect(find.text('Providus Bank'), findsOneWidget);
    expect(find.text('0123456789'), findsOneWidget);
  });

  testWidgets('funding workflow opens directly from its route',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.fund,
          routes: [
            GoRoute(
              path: AppRoutes.fund,
              builder: (context, state) => MoneyActionScreen(
                kind: MoneyActionKind.fund,
                apiClient: bundle.apiClient,
              ),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Add money'), findsOneWidget);
    expect(find.text('Copy account number'), findsOneWidget);
    expect(find.text('Providus Bank'), findsOneWidget);
    expect(find.text('0123456789'), findsOneWidget);
  });

  testWidgets('home screen opens the wallets overview from manage',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.home,
          routes: [
            GoRoute(
              path: AppRoutes.home,
              builder: (context, state) =>
                  HomeScreen(homeDataService: bundle.homeDataService),
            ),
            GoRoute(
              path: AppRoutes.wallets,
              builder: (context, state) => DashboardDetailScreen(
                kind: DashboardDetailKind.wallets,
                homeDataService: bundle.homeDataService,
              ),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.text('Manage'));
    await tester.pumpAndSettle();

    expect(find.text('Wallets'), findsOneWidget);
    expect(find.text('Active wallets'), findsOneWidget);
    expect(find.text('Add currency wallet'), findsOneWidget);
    expect(find.text('NGN'), findsWidgets);
    expect(find.text('GHS'), findsWidgets);
  });

  testWidgets('home screen opens notifications and dismisses them',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      kycStatus: 'PENDING',
      includeTransactions: false,
    );

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.home,
          routes: [
            GoRoute(
              path: AppRoutes.home,
              builder: (context, state) =>
                  HomeScreen(homeDataService: bundle.homeDataService),
            ),
            GoRoute(
              path: AppRoutes.notifications,
              builder: (context, state) => DashboardDetailScreen(
                kind: DashboardDetailKind.notifications,
                homeDataService: bundle.homeDataService,
              ),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.notifications_none_rounded));
    await tester.pumpAndSettle();

    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('KYC pending'), findsOneWidget);

    await tester.drag(find.text('KYC pending'), const Offset(-500, 0));
    await tester.pumpAndSettle();

    expect(find.text('KYC pending'), findsNothing);
  });
}
