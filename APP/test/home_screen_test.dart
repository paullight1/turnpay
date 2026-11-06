import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/core/widgets/micro_interactions.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';
import 'package:trustpay_app/features/home/screens/home_screen.dart';
import 'package:trustpay_app/features/home/screens/home_task_screen.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';
import 'package:trustpay_app/features/notifications/services/notifications_service.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets(
      'submitted KYC keeps account setup accessible alongside verification',
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
            path: AppRoutes.virtualAccount,
            builder: (context, state) =>
                const Scaffold(body: Text('Account setup progress'))),
      ]),
    ));
    await tester.pumpAndSettle();
    expect(
        find.text(
            'Your identity check is in progress. You can request your account now.'),
        findsOneWidget);
    expect(find.text('Request'), findsNothing);
    final progress =
        find.text('Your BVN check is in progress. View verification status.');
    await tester.scrollUntilVisible(progress, 180,
        scrollable: find.byType(Scrollable).first);
    expect(progress, findsOneWidget);
    await tester.scrollUntilVisible(find.text('Manage setup'), -180,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Manage setup'));
    await tester.pumpAndSettle();
    expect(find.text('Account setup progress'), findsOneWidget);
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

  testWidgets('balance visibility works before a receiving account exists',
      (tester) async {
    final bundle = buildTrustPayTestBundle(includeVirtualAccounts: false);
    await tester.pumpWidget(MaterialApp.router(
      routerConfig: GoRouter(initialLocation: AppRoutes.home, routes: [
        GoRoute(
            path: AppRoutes.home,
            builder: (_, __) =>
                HomeScreen(homeDataService: bundle.homeDataService)),
      ]),
    ));
    await tester.pumpAndSettle();
    expect(find.text('125,000.50'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.visibility_outlined).first);
    await tester.pumpAndSettle();
    expect(find.text('125,000.50'), findsNothing);
    await tester.tap(find.byIcon(Icons.visibility_off_outlined).first);
    await tester.pumpAndSettle();
    expect(find.text('125,000.50'), findsOneWidget);
  });

  testWidgets('V1 wallet card shows one full-width Add funds action',
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
              path: AppRoutes.receiveMoney,
              builder: (context, state) =>
                  const Scaffold(body: Text('Funding account opened')),
            ),
          ],
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Send money'), findsNothing);
    expect(find.text('Receive'), findsNothing);
    expect(find.textContaining('Quick transfer'), findsNothing);

    final addFundsAction = find.ancestor(
      of: find.text('Add funds').first,
      matching: find.byType(TapScale),
    );

    final actionSize = tester.getSize(addFundsAction.first);
    expect(actionSize.height, greaterThanOrEqualTo(48));
    expect(actionSize.width, greaterThan(220));

    await tester.tap(find.text('Add funds').first);
    await tester.pumpAndSettle();
    expect(find.text('Funding account opened'), findsOneWidget);
  });

  testWidgets('V1 hides the undeveloped Ghana wallet card and picker',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(homeDataService: bundle.homeDataService),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('125,000.50'), findsOneWidget);
    expect(find.text('3,300.75'), findsNothing);
    expect(find.byTooltip('Edit currencies'), findsNothing);
  });

  testWidgets('V1 funding menu does not advertise cedi accounts',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp(
        home: MoneyActionScreen(
          kind: MoneyActionKind.fund,
          apiClient: bundle.apiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();

    expect(find.text('Add cedis'), findsNothing);
    expect(find.text('Contact support'), findsOneWidget);
  });

  testWidgets('Add funds remains usable on a narrow phone with large text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: const TextScaler.linear(1.5),
          ),
          child: child!,
        ),
        home: HomeScreen(homeDataService: bundle.homeDataService),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Add funds'), findsWidgets);
    expect(find.text('Send money'), findsNothing);
    expect(tester.takeException(), isNull);
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
    expect(find.text('What can we help with?'), findsOneWidget);
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
    expect(find.text('Verify BVN'), findsOneWidget);
  });

  testWidgets('funding hides provider diagnostics for account setup recovery',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      kycStatus: 'PENDING',
      includeVirtualAccounts: false,
      virtualAccountProvisioningStatus: 'ACTION_REQUIRED',
      virtualAccountProvisioningMessage:
          'Paystack account setup needs attention. Contact support before retrying.',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: MoneyActionScreen(
          kind: MoneyActionKind.fund,
          apiClient: bundle.apiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text("We couldn't finish setting up your account"),
        findsOneWidget);
    expect(
      find.text(
          'Try account setup again. If it still doesn’t work, contact support.'),
      findsOneWidget,
    );
    expect(
      find.text(
          'Paystack account setup needs attention. Contact support before retrying.'),
      findsNothing,
    );
    expect(
      find.text(
          'Your BVN is verified. Try account setup again. If it still doesn’t work, contact support.'),
      findsNothing,
    );
  });

  testWidgets('home screen opens durable notifications and marks them read',
      (tester) async {
    final bundle = buildTrustPayTestBundle(
      kycStatus: 'PENDING',
      includeTransactions: false,
    );
    final notificationsService = _HomeTestNotificationService();

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: GoRouter(
          initialLocation: AppRoutes.home,
          routes: [
            GoRoute(
              path: AppRoutes.home,
              builder: (context, state) => HomeScreen(
                homeDataService: bundle.homeDataService,
                notificationsService: notificationsService,
              ),
            ),
            GoRoute(
              path: AppRoutes.notifications,
              builder: (context, state) => DashboardDetailScreen(
                kind: DashboardDetailKind.notifications,
                homeDataService: bundle.homeDataService,
                notificationsService: notificationsService,
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
    expect(find.text('Exchange payment confirmed'), findsOneWidget);

    await tester.tap(find.byTooltip('Mark as read'));
    await tester.pumpAndSettle();

    expect(find.text('Exchange payment confirmed'), findsOneWidget);
    expect(find.byTooltip('Mark as read'), findsNothing);
  });
}

class _HomeTestNotificationService extends NotificationsService {
  final TrustPayNotification notification = TrustPayNotification.fromJson({
    'id': 'notification-1',
    'eventKey': 'exchange-payment-confirmed:order-1',
    'audience': 'USER:user-1',
    'orderId': 'order-1',
    'title': 'Exchange payment confirmed',
    'createdAt': '2026-10-02T10:00:00.000Z',
    'readAt': null,
  });

  @override
  Future<List<TrustPayNotification>> fetchNotifications() async =>
      [notification];

  @override
  Future<int> fetchUnreadCount() async => 1;

  @override
  Future<NotificationReadRecord> markRead(
    String notificationId, {
    String? idempotencyKey,
  }) async {
    return NotificationReadRecord(
      notificationId: notificationId,
      readAt: DateTime.utc(2026, 10, 2, 11),
    );
  }
}
