import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/core/widgets/micro_interactions.dart';
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

  testWidgets('submitted KYC shows progress instead of asking to start again',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
        kycStatus: 'SUBMITTED', includeVirtualAccounts: false);
    await tester.pumpWidget(MaterialApp.router(
      routerConfig: GoRouter(initialLocation: AppRoutes.home, routes: [
        GoRoute(
            path: AppRoutes.home,
            builder: (context, state) =>
                HomeScreen(homeDataService: bundle.homeDataService)),
        GoRoute(
            path: AppRoutes.kyc,
            builder: (context, state) =>
                const Scaffold(body: Text('Identity check progress'))),
      ]),
    ));
    await tester.pumpAndSettle();
    expect(
        find.text(
            'Your Paystack account is waiting for identity verification.'),
        findsOneWidget);
    expect(find.text('Request'), findsNothing);
    final progress = find.text(
        'Your identity checks are in progress. View your BVN and NIN status.');
    await tester.scrollUntilVisible(progress, 180,
        scrollable: find.byType(Scrollable).first);
    expect(progress, findsOneWidget);
    await tester.scrollUntilVisible(find.text('View status'), -180,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('View status'));
    await tester.pumpAndSettle();
    expect(find.text('Identity check progress'), findsOneWidget);
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

    expect(find.textContaining('Good '), findsOneWidget);
    expect(find.text('Top services'), findsOneWidget);
    expect(find.text('Ada Lovelace'), findsWidgets);

    await tester.tap(find.byIcon(Icons.visibility_outlined).first);
    await tester.pumpAndSettle();

    expect(find.text('******'), findsWidgets);

    await tester.scrollUntilVisible(
      find.text('Exchange NGN to GHS'),
      150,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Exchange NGN to GHS'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('View more'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Recent transactions'), findsOneWidget);
    expect(find.text('Fund success'), findsOneWidget);

    await tester.tap(find.text('View more'));
    await tester.pumpAndSettle();

    expect(find.text('History'), findsOneWidget);
  });

  testWidgets('wallet calls to action provide 48-pixel tap targets',
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
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    final sendAction = find.ancestor(
      of: find.text('Send money').first,
      matching: find.byType(TapScale),
    );
    final receiveAction = find.ancestor(
      of: find.text('Receive').first,
      matching: find.byType(TapScale),
    );

    expect(tester.getSize(sendAction.first).height, greaterThanOrEqualTo(48));
    expect(
      tester.getSize(receiveAction.first).height,
      greaterThanOrEqualTo(48),
    );
  });

  testWidgets('only the Nigeria wallet offers account provisioning',
      (tester) async {
    final bundle = buildTrustPayTestBundle(includeVirtualAccounts: false);

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
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Request account'), findsOneWidget);
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
    await tester.scrollUntilVisible(
      find.text('Coming soon'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Coming soon'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Virtual cards'),
      400,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Virtual cards'), findsOneWidget);
    expect(
      find.text(
          'Pay online securely with instant cards you can freeze anytime.'),
      findsOneWidget,
    );
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
    expect(find.byTooltip('Copy account number'), findsOneWidget);
    expect(find.text('Providus Bank'), findsOneWidget);
    expect(find.textContaining('0123456789'), findsOneWidget);
  });

  testWidgets('funding workflow opens directly from its route', (tester) async {
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
    expect(find.byTooltip('Copy account number'), findsOneWidget);
    expect(find.text('Providus Bank'), findsOneWidget);
    expect(find.textContaining('0123456789'), findsOneWidget);
  });

  testWidgets('funding hides the account number until complete KYC',
      (tester) async {
    final bundle = buildTrustPayTestBundle(kycStatus: 'PENDING');

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

    expect(find.text('Account number locked'), findsOneWidget);
    expect(find.textContaining('0123456789'), findsNothing);
    expect(find.byTooltip('Copy account number'), findsNothing);
    expect(find.text('Complete KYC'), findsOneWidget);
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
