import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/exchange/screens/manual_exchange_screen.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('slow history does not block exchange direction selection',
      (tester) async {
    final service = _SlowHistory();
    await tester
        .pumpWidget(MaterialApp(home: ManualExchangeScreen(service: service)));
    await tester.pumpAndSettle();
    expect(find.text('Naira to cedis'), findsOneWidget);
    expect(find.text('Loading exchange history…'), findsOneWidget);
    service.orders.completeError(StateError('offline'));
    await tester.pumpAndSettle();
    expect(find.text('Naira to cedis'), findsOneWidget);
    expect(find.text('History could not load · Retry'), findsOneWidget);
  });

  testWidgets('shows the server confirmed manual exchange form',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ManualExchangeScreen(
          service: _FakeManualExchangeService(enabled: true),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Exchange'), findsOneWidget);
    expect(find.text('Naira to cedis'), findsOneWidget);
    expect(find.text('Cedis to naira'), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);
    await tester.tap(find.text('Naira to cedis'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '1000');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Choose where to receive GHS'), findsOneWidget);
    expect(find.text('TrustPay wallet'), findsOneWidget);
    expect(find.text('Bank account'), findsOneWidget);
    expect(find.text('Mobile money'), findsOneWidget);
    expect(find.text('View transfer account'), findsOneWidget);
  });

  testWidgets('cedis exchange advances to a naira payout step', (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
      service: _FakeManualExchangeService(enabled: true),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    expect(find.text('GHS '), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).first, '100');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Choose where to receive NGN'), findsOneWidget);
    expect(find.text('View transfer account'), findsOneWidget);
  });

  testWidgets('does not expose receiving instructions when the feature is off',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ManualExchangeScreen(
          service: _FakeManualExchangeService(enabled: false),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Exchange is currently unavailable.'), findsOneWidget);
    expect(find.text('TrustPay collection account'), findsNothing);
    expect(find.text('Continue'), findsNothing);
  });

  testWidgets('shows a pending create and restores its draft after restart',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ManualExchangeScreen(
          service: _FakeManualExchangeService(
            enabled: true,
            pendingCreate: const ManualExchangeAttempt(
              action: 'create',
              fingerprint:
                  '{"amount":"100.00","settlementMode":"BANK","destinationInstitution":"GCB Bank","destinationAccount":"23312345678","destinationName":"A User"}',
              key: '12345678-1234-4234-8234-123456789012',
              orderId: null,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Exchange request pending'), findsOneWidget);
    expect(find.text('Retry exchange'), findsOneWidget);
    expect(find.text('GCB Bank'), findsOneWidget);
    expect(find.text('23312345678'), findsOneWidget);
  });

  testWidgets('retry picks up enabled configuration without reopening Exchange',
      (tester) async {
    final service = _FakeManualExchangeService(enabled: false);
    await tester
        .pumpWidget(MaterialApp(home: ManualExchangeScreen(service: service)));
    await tester.pumpAndSettle();
    service.enabled = true;
    await tester.tap(find.text('Check availability'));
    await tester.pumpAndSettle();
    expect(find.text('Choose your exchange'), findsOneWidget);
    expect(find.text('Exchange is currently unavailable.'), findsNothing);
  });

  testWidgets('resuming refreshes availability and preserves the amount draft',
      (tester) async {
    final service = _FakeManualExchangeService(enabled: true);
    await tester
        .pumpWidget(MaterialApp(home: ManualExchangeScreen(service: service)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Naira to cedis'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '1234');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(service.configReads, greaterThan(1));
    expect(find.text('1,234'), findsOneWidget);
  });
}

class _FakeManualExchangeService extends ManualExchangeService {
  @override
  Future<Map<String, dynamic>> previewRate(String source) async => {
        'effectiveRate': source == 'NGN' ? '0.01' : '100',
        'isStale': false,
      };
  bool enabled;
  int configReads = 0;
  final ManualExchangeAttempt? pendingCreate;

  _FakeManualExchangeService({required this.enabled, this.pendingCreate})
      : super();

  @override
  Future<ManualExchangeConfig> fetchConfig() async {
    configReads++;
    return ManualExchangeConfig(
      enabled: enabled,
      sourceCurrency: 'NGN',
      targetCurrency: 'GHS',
      supportedSourceCurrencies: const ['NGN', 'GHS'],
    );
  }

  @override
  Future<List<ManualExchangeOrder>> listOrders() async => const [];

  @override
  Future<ManualExchangeAttempt?> pendingCreateAttempt() async => pendingCreate;
}

class _SlowHistory extends _FakeManualExchangeService {
  _SlowHistory() : super(enabled: true);
  final orders = Completer<List<ManualExchangeOrder>>();
  @override
  Future<List<ManualExchangeOrder>> listOrders() => orders.future;
}
