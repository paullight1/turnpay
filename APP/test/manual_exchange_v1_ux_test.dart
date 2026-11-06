import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:go_router/go_router.dart';
import 'package:trustpay_app/services/kora_service.dart';
import 'package:trustpay_app/features/exchange/screens/kora_exchange_screen.dart';
import 'package:trustpay_app/features/exchange/screens/manual_exchange_screen.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/exchange/screens/manual_exchange_order_screen.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';

void main() {
  setUp(() {
    GoogleFonts.config.allowRuntimeFetching = false;
    FlutterSecureStorage.setMockInitialValues({});
  });
  test('old wallet-only configuration cannot offer a new wallet exchange', () {
    final config = ManualExchangeConfig.fromJson({
      'enabled': true,
      'deliveryPolicyVersion': 1,
      'sourceCurrency': 'GHS',
      'targetCurrency': 'NGN',
      'supportedSourceCurrencies': ['GHS', 'NGN'],
      'settlementOptions': {
        'GHS': ['WALLET'],
        'NGN': ['BANK', 'MOMO']
      }
    });
    expect(config.canExchangeFrom('GHS'), isFalse);
    expect(config.deliveryModesFor('GHS'), isEmpty);
    expect(config.canExchangeFrom('NGN'), isTrue);
  });
  test('receipt progress is durable and isolated by account', () async {
    var account = 'customer-a';
    final store =
        ManualExchangeAttemptStore(accountScopeProvider: () async => account);
    await store.rememberExchangeOrder('created-before-receipt');
    expect(await store.latestExchangeOrderId(), 'created-before-receipt');
    expect(await store.receiptStepStarted('created-before-receipt'), isFalse);
    await store.markReceiptStepStarted('original-order');
    expect(await store.receiptStepStarted('original-order'), isTrue);
    expect(await store.pendingReceiptOrderId(), 'original-order');
    account = 'customer-b';
    expect(await store.receiptStepStarted('original-order'), isFalse);
    expect(await store.pendingReceiptOrderId(), isNull);
    expect(await store.latestExchangeOrderId(), isNull);
    account = 'customer-a';
    final reopened =
        ManualExchangeAttemptStore(accountScopeProvider: () async => account);
    expect(await reopened.receiptStepStarted('original-order'), isTrue);
  });
  for (final entry in ['availability', 'manual']) {
    testWidgets(
        'saved original exchange remains reachable when $entry configuration is offline',
        (tester) async {
      final service = _V1Service()
        ..receiptStarted = true
        ..configOffline = true;
      final router = GoRouter(initialLocation: '/entry', routes: [
        GoRoute(
            path: '/entry',
            builder: (_, __) => entry == 'availability'
                ? ExchangeEntryScreen(
                    service: _OfflineAvailability(), manualService: service)
                : ManualExchangeScreen(service: service)),
        GoRoute(
            path: '/exchange/orders/:id',
            builder: (_, state) =>
                Text('Original order: ${state.pathParameters['id']}')),
      ]);
      await tester.pumpWidget(
          MaterialApp.router(theme: AppTheme.light, routerConfig: router));
      await tester.pumpAndSettle();
      if (entry == 'manual') {
        expect(find.text('Exchange could not load.'), findsOneWidget);
        expect(find.text('Continue previous exchange'), findsNothing);
        await tester.pumpWidget(const SizedBox());
        router.dispose();
        return;
      }
      final resume = find.text(entry == 'availability'
          ? 'Continue receipt upload'
          : 'Continue previous exchange');
      await tester.ensureVisible(resume);
      await tester.tap(resume);
      await tester.pumpAndSettle();
      expect(find.text('Original order: original-order'), findsOneWidget);
      expect(service.submittedIds, isEmpty);
      await tester.pumpWidget(const SizedBox());
      router.dispose();
    });
  }
  testWidgets('exchange failure leaves previous orders in the History tab',
      (tester) async {
    final service = _V1Service()
      ..configOffline = true
      ..historyAvailableOffline = true;
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light, home: ManualExchangeScreen(service: service)));
    await tester.pumpAndSettle();
    expect(find.text('Exchange history'), findsNothing);
    expect(find.text('Continue exchange'), findsNothing);
    expect(find.text('Exchange could not load.'), findsOneWidget);
  });
  testWidgets(
      'a lost receipt response is reconciled from server status without submitting again',
      (tester) async {
    final service = _V1Service()
      ..receiptStarted = true
      ..serverAcceptedBeforeError = true;
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: ManualExchangeOrderScreen(
          orderId: 'original-order',
          service: service,
          pickReceipt: () async => ManualExchangeProofFile(
              fileName: 'receipt.png',
              contentType: 'image/png',
              bytes: Uint8List.fromList([137, 80, 78, 71])),
        )));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Bank reference'), 'TRANSFER-001');
    await tester.ensureVisible(find.text('Choose receipt'));
    await tester.tap(find.text('Choose receipt'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Confirm payment & submit receipt'));
    await tester.tap(find.text('Confirm payment & submit receipt'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 15));
    await tester.pumpAndSettle();
    expect(find.text('Awaiting admin review'), findsOneWidget);
    expect(find.text('Confirm payment & submit receipt'), findsNothing);
    expect(service.submittedIds, ['original-order']);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
      'an active manual receipt stays in History when provider exchange is available',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues(
        {'exchange-introduction-started-v1': 'true'});
    final manual = _V1Service()..receiptStarted = true;
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: ExchangeEntryScreen(
            service: _ProviderAvailability(), manualService: manual)));
    await tester.pumpAndSettle();
    expect(find.text('Continue manual exchange'), findsNothing);
    expect(find.byType(KoraExchangeScreen), findsOneWidget);
    expect(manual.submittedIds, isEmpty);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
      'an accepted exchange under review does not lock another exchange',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues(
        {'exchange-introduction-started-v1': 'true'});
    final manual = _V1Service()
      ..receiptStarted = true
      ..current =
          fixtureV1Order(status: 'AWAITING_CONFIRMATION', hasProof: true);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: ExchangeEntryScreen(
            service: _ProviderAvailability(), manualService: manual)));
    await tester.pumpAndSettle();
    expect(find.byType(KoraExchangeScreen), findsOneWidget);
    expect(find.text('Your earlier exchange is still open'), findsNothing);
    expect(find.text('Start another exchange'), findsNothing);
    expect(manual.submittedIds, isEmpty);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
      'completed manual metadata does not capture a new provider exchange',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues(
        {'exchange-introduction-started-v1': 'true'});
    final manual = _V1Service()
      ..receiptStarted = true
      ..current = fixtureV1Order(status: 'COMPLETED', hasProof: true);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: ExchangeEntryScreen(
            service: _ProviderAvailability(), manualService: manual)));
    await tester.pumpAndSettle();
    expect(find.text('Continue manual exchange'), findsNothing);
    expect(find.byType(KoraExchangeScreen), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('a historical wallet order keeps its recorded delivery meaning',
      (tester) async {
    final service = _V1Service()
      ..current = fixtureV1Order(
          status: 'AWAITING_CONFIRMATION',
          hasProof: true,
          settlementMode: 'WALLET');
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: ManualExchangeOrderScreen(
            orderId: 'original-order', service: service)));
    await tester.pumpAndSettle();
    expect(find.textContaining('original wallet destination'), findsOneWidget);
    expect(find.textContaining('before sending to your receiving account'),
        findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
      'reopening a paid exchange resumes receipt upload instead of asking for another transfer',
      (tester) async {
    final service = _V1Service()..receiptStarted = true;
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: ManualExchangeOrderScreen(
            orderId: 'original-order', service: service)));
    await tester.pumpAndSettle();
    expect(find.text('Upload your receipt'), findsOneWidget);
    expect(find.text('Transfer to this account'), findsNothing);
    expect(find.textContaining('Do not make another transfer'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
      'offline receipt retry keeps the same order and waits for admin review',
      (tester) async {
    final service = _V1Service()..receiptStarted = true;
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: ManualExchangeOrderScreen(
          orderId: 'original-order',
          service: service,
          pickReceipt: () async => ManualExchangeProofFile(
              fileName: 'receipt.png',
              contentType: 'image/png',
              bytes: Uint8List.fromList([137, 80, 78, 71])),
        )));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Bank reference'), 'TRANSFER-001');
    await tester.ensureVisible(find.text('Choose receipt'));
    await tester.tap(find.text('Choose receipt'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Confirm payment & submit receipt'));
    await tester.tap(find.text('Confirm payment & submit receipt'));
    await tester.pumpAndSettle();
    expect(find.text('receipt.png'), findsOneWidget);
    expect(find.textContaining('Do not make another transfer'), findsWidgets);
    await tester.ensureVisible(find.text('Confirm payment & submit receipt'));
    await tester.tap(find.text('Confirm payment & submit receipt'));
    await tester.pumpAndSettle();
    expect(service.submittedIds, ['original-order', 'original-order']);
    expect(find.text('Awaiting admin review'), findsWidgets);
    expect(find.text('Transfer to this account'), findsNothing);
    expect(find.text('Credited to wallet'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
}

class _V1Service extends ManualExchangeService {
  bool receiptStarted = false;
  bool configOffline = false, serverAcceptedBeforeError = false;
  bool historyAvailableOffline = false;
  int submissions = 0;
  final submittedIds = <String>[];
  ManualExchangeOrder current = fixtureV1Order();
  @override
  Future<String?> latestExchangeOrderId() async =>
      receiptStarted ? 'original-order' : null;
  @override
  Future<ManualExchangeAttempt?> pendingCreateAttempt() async => null;
  @override
  Future<List<ManualExchangeOrder>> listOrders() async =>
      configOffline && !historyAvailableOffline
          ? throw StateError('offline fixture')
          : [current];
  @override
  Future<ManualExchangeConfig> fetchConfig() async => configOffline
      ? throw StateError('offline fixture')
      : const ManualExchangeConfig(
          enabled: true,
          sourceCurrency: 'GHS',
          targetCurrency: 'NGN',
          supportedSourceCurrencies: ['GHS', 'NGN']);
  @override
  Future<ManualExchangeOrder> getOrder(String id) async => current;
  @override
  Future<bool> receiptStepStarted(String id) async => receiptStarted;
  @override
  Future<void> markReceiptStepStarted(String id) async {
    receiptStarted = true;
  }

  @override
  Future<void> clearReceiptStep(String id) async {
    receiptStarted = false;
  }

  @override
  Future<ManualExchangeOrder> submitProof(
      {required String orderId,
      required ManualExchangeProofFile file,
      required String bankReference}) async {
    submittedIds.add(orderId);
    if (submissions++ == 0) {
      if (serverAcceptedBeforeError) {
        current =
            fixtureV1Order(status: 'AWAITING_CONFIRMATION', hasProof: true);
      }
      throw DioException.connectionError(
          requestOptions: RequestOptions(path: '/proof'),
          reason: 'offline fixture');
    }
    return current =
        fixtureV1Order(status: 'AWAITING_CONFIRMATION', hasProof: true);
  }
}

ManualExchangeOrder fixtureV1Order(
        {String id = 'original-order',
        String status = 'AWAITING_TRANSFER',
        bool hasProof = false,
        String settlementMode = 'BANK',
        bool remindersEnabled = false}) =>
    ManualExchangeOrder.fromJson({
      'id': id,
      'reference': 'EX-FIXTURE-001',
      'status': status,
      'settlementMode': settlementMode,
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
      'hasProof': hasProof,
      'reviewRemindersEnabled': remindersEnabled,
      'hasPayoutProof': false,
      'events': <dynamic>[],
    });

class _OfflineAvailability extends KoraService {
  @override
  Future<Map<String, dynamic>> config() async =>
      throw StateError('offline fixture');
}

class _ProviderAvailability extends KoraService {
  @override
  Future<Map<String, dynamic>> config() async =>
      {'enabled': true, 'hasOrders': true};
  @override
  Future<Map<String, dynamic>?> pendingAttempt() async => null;
  @override
  Future<Map<String, dynamic>?> pendingMutation(String action) async => null;
  @override
  Future<Map<String, String>> balances() async =>
      {'GHS': '0.00', 'NGN': '0.00'};
  @override
  Future<List<KoraOrder>> orders() async => [];
}
