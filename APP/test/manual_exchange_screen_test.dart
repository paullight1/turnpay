import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';

import 'package:trustpay_app/features/exchange/screens/manual_exchange_screen.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('header back returns through exchange steps and keeps the amount',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
            showBackButton: false,
            service: _FakeManualExchangeService(enabled: true))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '100');
    await tester.ensureVisible(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(CustomScrollView), const Offset(0, 1000));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.text('100'), findsOneWidget);
    expect(find.text('Back'), findsNothing);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, 1000));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Choose your exchange'), findsOneWidget);
    expect(find.byTooltip('Back'), findsNothing);
  });

  for (final variant in [
    (size: const Size(320, 740), scale: 1.5, dark: true),
    (size: const Size(430, 932), scale: 1.0, dark: false),
    (size: const Size(1024, 900), scale: 1.0, dark: false),
  ]) {
    testWidgets('amount entry fits ${variant.size} at ${variant.scale} text',
        (tester) async {
      tester.view.physicalSize = variant.size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(MaterialApp(
          theme: variant.dark ? AppTheme.dark : AppTheme.light,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(variant.scale)),
              child: child!),
          home: ManualExchangeScreen(
              service: _FakeManualExchangeService(enabled: true))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cedis to naira'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, '9999999.99');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Continue'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(find.text('Naira goes to your TrustPay wallet'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }

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
    await tester.ensureVisible(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Receive cedis'), findsOneWidget);
    expect(find.text('TrustPay wallet'), findsNothing);
    expect(find.text('Bank account'), findsOneWidget);
    expect(find.text('Mobile money'), findsOneWidget);
    expect(find.text('View transfer account'), findsOneWidget);
  });

  testWidgets(
      'only offers a ready direction and prevents swapping into an unconfigured one',
      (tester) async {
    final service = _FakeManualExchangeService(
        enabled: true, availableSourceCurrencies: const ['NGN']);
    await tester
        .pumpWidget(MaterialApp(home: ManualExchangeScreen(service: service)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNothing);
    await tester.tap(find.text('Naira to cedis'));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsWidgets);
    await tester.enterText(find.byType(TextFormField).first, '1000');
    await tester.tap(find.byTooltip('Swap currencies'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextFormField>(find.byType(TextFormField).first)
            .controller!
            .text,
        '1,000');
  });

  testWidgets('cedis exchange advances to a naira payout step', (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
      service: _FakeManualExchangeService(enabled: true),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    expect(find.text('GHS'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).first, '100');
    await tester.ensureVisible(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Naira goes to your TrustPay wallet'), findsOneWidget);
    expect(find.text('Bank account'), findsNothing);
    expect(find.text('Mobile money'), findsNothing);
    expect(find.text('View transfer account'), findsOneWidget);
  });

  testWidgets('cedi-to-naira receiving step fits a phone with larger text',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!),
        home: ManualExchangeScreen(
            service: _FakeManualExchangeService(enabled: true))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '100');
    await tester.ensureVisible(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Naira goes to your TrustPay wallet'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('View transfer account'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
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
  final List<String>? availableSourceCurrencies;
  final ManualExchangeAttempt? pendingCreate;

  _FakeManualExchangeService(
      {required this.enabled,
      this.pendingCreate,
      this.availableSourceCurrencies})
      : super();

  @override
  Future<ManualExchangeConfig> fetchConfig() async {
    configReads++;
    return ManualExchangeConfig.fromJson({
      'enabled': enabled,
      'sourceCurrency': 'NGN',
      'targetCurrency': 'GHS',
      'supportedSourceCurrencies': ['NGN', 'GHS'],
      if (availableSourceCurrencies != null)
        'availableSourceCurrencies': availableSourceCurrencies,
    });
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
