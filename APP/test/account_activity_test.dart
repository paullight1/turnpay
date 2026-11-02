import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';
import 'package:trustpay_app/features/notifications/services/notifications_service.dart';
import 'package:trustpay_app/services/home_data_service.dart';
import 'support/trustpay_test_api.dart';

class ClosureService extends HomeDataService {
  ClosureService(this.delegate);
  final HomeDataService delegate;
  @override
  Future<HomeDashboardData> fetchDashboard() => delegate.fetchDashboard();
  @override
  Future<List<HomeTransaction>> fetchTransactions({int limit = 20}) =>
      delegate.fetchTransactions(limit: limit);
  @override
  Future<List<SupportTicket>> fetchSupportTickets({int limit = 10}) async => [
        const SupportTicket(
            id: 'closure-42',
            type: 'ACCOUNT',
            description: 'Account deletion requested from mobile profile.',
            status: 'OPEN',
            resolution: '',
            createdAt: null,
            transactionReference: ''),
      ];
}

void main() {
  setUp(() => setMockSecureStorage(refreshToken: 'refresh-token'));
  testWidgets(
      'notifications use the durable inbox instead of transaction synthesis',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final notifications = _AccountActivityNotificationService();
    await tester.pumpWidget(MaterialApp(
        home: DashboardDetailScreen(
            kind: DashboardDetailKind.notifications,
            homeDataService: bundle.homeDataService,
            notificationsService: notifications)));
    await tester.pumpAndSettle();
    expect(find.text('Wallets are live'), findsNothing);
    expect(find.text('Exchange payment confirmed'), findsOneWidget);
    expect(find.textContaining('Reference:'), findsNothing);
  });
  testWidgets(
      'reopened profile restores closure request reference and honest support status',
      (tester) async {
    final service = ClosureService(buildTrustPayTestBundle().homeDataService);
    await tester.pumpWidget(MaterialApp(
        home: ProfileActionScreen(
            kind: ProfileActionKind.account, homeDataService: service)));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
        find.text('Closure request closure-42'), 500,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Support status: OPEN'), findsOneWidget);
    expect(
        find.text(
            'A support status does not by itself confirm account deletion.'),
        findsOneWidget);
  });
}

class _AccountActivityNotificationService extends NotificationsService {
  @override
  Future<List<TrustPayNotification>> fetchNotifications() async => [
        TrustPayNotification.fromJson({
          'id': 'notification-1',
          'eventKey': 'exchange-payment-confirmed:order-1',
          'audience': 'USER:user-1',
          'orderId': 'order-1',
          'title': 'Exchange payment confirmed',
          'createdAt': '2026-10-02T10:00:00.000Z',
          'readAt': null,
        }),
      ];
}
