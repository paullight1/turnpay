import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';

import 'package:trustpay_app/features/exchange/screens/manual_exchange_screen.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (!const bool.fromEnvironment('EXCHANGE_CAPTURE')) return;
    final icons = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await icons.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await icons.readAsBytes()))))
          .load();
    }
  });

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
    expect(find.text('Select a receiving method to enter its details.'),
        findsOneWidget);
    expect(find.byKey(const ValueKey('exchange-bank-field')), findsNothing);
    await tester.tap(find.text('Mobile money'));
    await tester.pumpAndSettle();
    expect(find.text('View transfer account'), findsOneWidget);
  });

  testWidgets('converter does not show the PIN helper copy', (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
      service: _FakeManualExchangeService(enabled: true),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Naira to cedis'));
    await tester.pumpAndSettle();

    expect(find.text('Your PIN protects this exchange.'), findsNothing);
    expect(find.text('Your PIN protects this exchange'), findsNothing);
  });

  testWidgets('asks where to receive before revealing the cedi form',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
      service: _FakeManualExchangeService(enabled: true),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Naira to cedis'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '1000');
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('Choose where to receive your cedis.'), findsOneWidget);
    expect(find.byKey(const ValueKey('exchange-bank-field')), findsNothing);
    expect(
        find.byKey(const ValueKey('exchange-momo-number-field')), findsNothing);
    expect(find.text('Recipient name'), findsNothing);
    expect(find.text('MoMo number'), findsNothing);
    expect(find.text('Bank name'), findsNothing);
    expect(find.text('Mobile money'), findsOneWidget);
    expect(find.text('Bank account'), findsOneWidget);
  });

  testWidgets('mobile money selection reveals its destination form',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
      service: _FakeManualExchangeService(enabled: true),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Naira to cedis'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '1000');
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mobile money'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('exchange-momo-number-field')),
        findsOneWidget);
    expect(find.text('Recipient name'), findsOneWidget);
    expect(
      find.text(
          'We check the recipient name with the provider after you choose a network.'),
      findsOneWidget,
    );
  });

  testWidgets(
      'MoMo recipient name appears automatically after number and network',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
            service: _FakeManualExchangeService(enabled: true))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Naira to cedis'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '1000');
    await tester.ensureVisible(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mobile money'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('exchange-momo-number-field')), '0241234567');
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MTN MoMo').last);
    await tester.pump(const Duration(milliseconds: 650));
    await tester.pumpAndSettle();
    expect(find.text('Synthetic Verified Recipient'), findsOneWidget);
  });

  testWidgets('bank form puts account number before searchable bank field',
      (tester) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final key = GlobalKey();
    await tester.pumpWidget(RepaintBoundary(
        key: key,
        child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light,
            home: ManualExchangeScreen(
                service: _FakeManualExchangeService(enabled: true)))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Naira to cedis'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '1000');
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await _captureExchange(tester, key, 'receive-choice');
    await tester.tap(find.text('Bank account'));
    await tester.pumpAndSettle();

    final account = find.byKey(const ValueKey('exchange-bank-account-field'));
    final bank = find.byKey(const ValueKey('exchange-bank-field'));
    expect(account, findsOneWidget);
    expect(bank, findsOneWidget);
    expect(tester.getTopLeft(account).dy, lessThan(tester.getTopLeft(bank).dy));

    await _captureExchange(tester, key, 'receive-bank');
    await tester.tap(bank);
    await tester.pumpAndSettle();
    expect(find.text('Absa Bank Ghana LTD'), findsOneWidget);
    await _captureExchange(tester, key, 'receive-bank-list');
    await tester.enterText(
        find.byKey(const ValueKey('exchange-bank-search')), 'gcb');
    await tester.pumpAndSettle();
    expect(find.text('GCB Bank Plc'), findsOneWidget);
    await tester.tap(find.text('GCB Bank Plc'));
    await tester.pumpAndSettle();
    expect(find.text('GCB Bank Plc'), findsOneWidget);
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

  @override
  Future<ManualGhanaPayoutCapabilities> fetchGhanaPayoutCapabilities() async =>
      const ManualGhanaPayoutCapabilities(
        enabled: true,
        momoPayouts: true,
        bankPayouts: false,
      );

  @override
  Future<List<ManualGhanaMomoOperator>> fetchGhanaMomoOperators() async =>
      const [ManualGhanaMomoOperator(slug: 'mtn', name: 'MTN MoMo')];

  @override
  Future<ManualGhanaRecipientResolution> resolveGhanaMomoRecipient({
    required String number,
    required String operator,
  }) async =>
      ManualGhanaRecipientResolution(
        name: 'Synthetic Verified Recipient',
        number: normalizeGhanaMobileNumber(number),
        operator: operator,
      );
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

Future<void> _captureExchange(
    WidgetTester tester, GlobalKey key, String name) async {
  if (!const bool.fromEnvironment('EXCHANGE_CAPTURE')) return;
  await tester
      .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 500)));
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('../output/exchange-ux/$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}
