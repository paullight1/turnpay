import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/core/widgets/tp_page_header.dart';
import 'package:trustpay_app/features/home/screens/dashboard_detail_screen.dart';
import 'package:trustpay_app/features/notifications/services/notifications_service.dart';
import 'package:trustpay_app/services/home_data_service.dart';
import 'package:trustpay_app/services/kora_service.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';
import 'support/trustpay_test_api.dart';

class ClosureService extends HomeDataService {
  ClosureService(this.delegate);
  final HomeDataService delegate;
  @override
  Future<HomeDashboardData> fetchDashboard() => delegate.fetchDashboard();
  @override
  Future<HomeAccountDetailsData> fetchAccountDetails() =>
      delegate.fetchAccountDetails();
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

class _AccountDetailsFastPathService extends HomeDataService {
  _AccountDetailsFastPathService(this.delegate);

  final HomeDataService delegate;
  final transactionsReleased = Completer<List<HomeTransaction>>();
  bool dashboardRequested = false;

  @override
  Future<HomeDashboardData> fetchDashboard() async {
    dashboardRequested = true;
    throw StateError('Account Details should not load the full dashboard.');
  }

  @override
  Future<HomeAccountDetailsData> fetchAccountDetails() =>
      delegate.fetchAccountDetails();

  @override
  Future<List<HomeTransaction>> fetchTransactions({int limit = 20}) =>
      transactionsReleased.future;

  @override
  Future<HomeVirtualAccountProvisioning> fetchVirtualAccountProvisioning() =>
      delegate.fetchVirtualAccountProvisioning();

  @override
  Future<List<SupportTicket>> fetchSupportTickets({int limit = 10}) =>
      delegate.fetchSupportTickets(limit: limit);
}

void main() {
  setUp(() {
    GoogleFonts.config.allowRuntimeFetching = false;
    setMockSecureStorage(refreshToken: 'refresh-token');
  });
  testWidgets('security retains its controls without reminder or session cards',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.dark,
      home: ProfileActionScreen(
          kind: ProfileActionKind.security,
          homeDataService: bundle.homeDataService),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Transaction PIN'), findsOneWidget);
    expect(find.text('App unlock'), findsOneWidget);
    expect(find.text('Tier 1 verification'), findsOneWidget);
    expect(find.text('Active Sessions'), findsNothing);
    expect(find.textContaining('All money actions request'), findsNothing);
  });
  for (final size in [
    const Size(320, 640),
    const Size(430, 932),
    const Size(1024, 768)
  ]) {
    testWidgets('account details keeps long values readable at $size',
        (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service =
          _LongIdentityService(buildTrustPayTestBundle().homeDataService);
      await tester.pumpWidget(MaterialApp(
        theme: size.width == 430 ? AppTheme.light : AppTheme.dark,
        builder: (_, child) => MediaQuery(
            data: MediaQueryData(
                size: size,
                padding: const EdgeInsets.only(top: 44, bottom: 24),
                textScaler: TextScaler.linear(size.width == 430 ? 1 : 1.8)),
            child: child!),
        home: ProfileActionScreen(
            kind: ProfileActionKind.account, homeDataService: service),
      ));
      await tester.pumpAndSettle();
      expect(find.byType(TpAppHeader), findsOneWidget);
      expect(tester.getRect(find.byType(TpAppHeader)).width, size.width);
      expect(find.text('Identity details'), findsOneWidget);
      final email = find.byWidgetPredicate(
          (w) => w is SelectableText && w.data == _LongIdentityService.email);
      await tester.ensureVisible(email);
      await tester.pumpAndSettle();
      expect(tester.widget<SelectableText>(email).maxLines, isNull);
      expect(tester.getRect(email).right, lessThanOrEqualTo(size.width - 16));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }
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
  testWidgets(
      'account details renders before optional transaction volume finishes',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final service = _AccountDetailsFastPathService(bundle.homeDataService);
    await tester.pumpWidget(MaterialApp(
        home: ProfileActionScreen(
            kind: ProfileActionKind.account, homeDataService: service)));
    await tester.pumpAndSettle();

    expect(service.dashboardRequested, isFalse);
    expect(find.text('Identity details'), findsOneWidget);
    expect(find.text('Transaction volume'), findsOneWidget);
    expect(find.text('Updating...'), findsOneWidget);

    service.transactionsReleased.complete(const []);
    await tester.pumpAndSettle();
  });
  testWidgets('the History tab includes exchange orders', (tester) async {
    final bundle = buildTrustPayTestBundle(includeTransactions: false);
    await tester.pumpWidget(MaterialApp(
        home: DashboardTransactionsScreen(
            homeDataService: bundle.homeDataService,
            manualExchangeService: _HistoryManualService(),
            koraService: _HistoryKoraService())));
    await tester.pumpAndSettle();
    expect(find.text('History'), findsOneWidget);
    expect(find.text('Exchange history'), findsOneWidget);
    expect(find.text('View review status'), findsOneWidget);
    expect(find.text('Our team is checking this payment'), findsOneWidget);
  });
}

class _LongIdentityService extends ClosureService {
  _LongIdentityService(super.delegate);
  static const email = 'alexandra.long.identity@example.test';
  @override
  Future<HomeAccountDetailsData> fetchAccountDetails() async {
    final original = await delegate.fetchAccountDetails();
    return HomeAccountDetailsData(
      user: HomeUser.fromJson({
        'id': original.user.id,
        'email': email,
        'phone': '+2348012345678',
        'fullName': 'Alexandra Morgan Long Identity Name',
        'role': 'USER',
        'kycStatus': 'VERIFIED',
        'kycTier': 'TIER_1',
        'yearOfBirth': 1990,
        'country': 'NG',
        'profileDetailsUpdatedAt': '2026-11-01T00:00:00Z',
      }),
      virtualAccounts: original.virtualAccounts,
    );
  }
}

class _HistoryManualService extends ManualExchangeService {
  @override
  Future<List<ManualExchangeOrder>> listOrders() async => [
        ManualExchangeOrder.fromJson({
          'id': 'manual-order-1',
          'reference': 'EX-HISTORY-001',
          'status': 'AWAITING_CONFIRMATION',
          'settlementMode': 'BANK',
          'sourceCurrency': 'GHS',
          'targetCurrency': 'NGN',
          'amount': '100.00',
          'targetAmount': '10000.00',
          'rate': '100.000000',
          'fee': '0.00',
          'collectionAccount': {
            'bankName': 'Collection Bank',
            'accountName': 'TrustPay Collection',
            'accountNumber': '0123456789',
            'currency': 'GHS',
            'version': 'v1'
          },
          'createdAt': '2026-11-04T10:00:00.000Z',
          'updatedAt': '2026-11-04T10:00:00.000Z',
          'expiresAt': '2026-11-05T10:00:00.000Z',
          'destinationInstitution': 'Recipient Bank',
          'destinationAccountMasked': '******6789',
          'destinationName': 'Alex Morgan',
          'hasProof': true,
          'hasPayoutProof': false,
          'events': <dynamic>[],
        })
      ];
}

class _HistoryKoraService extends KoraService {
  @override
  Future<List<KoraOrder>> orders() async => [
        KoraOrder.fromJson({
          'id': 'provider-order-1',
          'reference': 'PX-HISTORY-001',
          'status': 'NEEDS_REVIEW',
          'quote': {
            'id': 'quote-1',
            'sourceCurrency': 'NGN',
            'targetCurrency': 'GHS',
            'fundingSource': 'EXTERNAL',
            'amount': '5000.00',
            'fee': '100.00',
            'total': '5100.00',
            'rate': '0.060000',
            'targetAmount': '300.00',
            'destinationName': 'Ama Mensah',
            'destinationMasked': '024***4567',
            'destinationCode': 'mtn',
            'expiresAt': '2026-11-04T11:00:00.000Z',
          },
        })
      ];
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
