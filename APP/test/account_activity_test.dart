import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';
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
      'activity uses server transactions instead of a static wallets-live alert',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(MaterialApp(
        home: DashboardDetailScreen(
            kind: DashboardDetailKind.notifications,
            homeDataService: bundle.homeDataService)));
    await tester.pumpAndSettle();
    expect(find.text('Wallets are live'), findsNothing);
    expect(find.textContaining('Reference:'), findsWidgets);
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
