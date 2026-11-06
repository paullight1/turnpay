import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/services/kyc_service.dart';
import 'package:trustpay_app/services/auth_service.dart';

import 'package:trustpay_app/features/exchange/screens/manual_exchange_screen.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';
import 'manual_exchange_v1_ux_test.dart' show fixtureV1Order;

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

  testWidgets('header back protects a started exchange draft', (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
            showBackButton: false,
            service: _FakeManualExchangeService(enabled: true))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '100');
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();

    expect(find.text('Cancel this exchange?'), findsOneWidget);
    expect(find.text('Keep exchange'), findsOneWidget);
    expect(find.text('Cancel exchange'), findsOneWidget);

    await tester.tap(find.text('Keep exchange'));
    await tester.pumpAndSettle();
    expect(find.text('100'), findsOneWidget);

    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel exchange'));
    await tester.pumpAndSettle();
    expect(find.text('Start a new exchange'), findsOneWidget);
    expect(find.byTooltip('Back'), findsNothing);

    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    final amountField = tester.widget<TextFormField>(
      find.byType(TextFormField).first,
    );
    expect(amountField.controller?.text, isEmpty);
  });

  testWidgets('system back uses the same draft warning', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ManualExchangeScreen(
                    service: _FakeManualExchangeService(enabled: true),
                  ),
                ),
              ),
              child: const Text('Open exchange'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open exchange'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Cancel this exchange?'), findsOneWidget);

    await tester.tap(find.text('Cancel exchange'));
    await tester.pumpAndSettle();
    expect(find.text('Start a new exchange'), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Open exchange'), findsOneWidget);
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
      final captureKey = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(
          key: captureKey,
          child: MaterialApp(
              theme: variant.dark ? AppTheme.dark : AppTheme.light,
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(variant.scale)),
                  child: child!),
              home: ManualExchangeScreen(
                  service: _FakeManualExchangeService(enabled: true)))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cedis to naira'));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byType(TextFormField).first, '250000000000.00');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Continue'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(find.text('Enter Nigerian bank account number'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _captureExchange(
          tester, captureKey, 'receive-naira-${variant.size.width.toInt()}');
      await tester.pumpWidget(const SizedBox());
    });
  }

  testWidgets('exchange chooser shows recent history below both directions',
      (tester) async {
    final service = _SlowHistory();
    await tester
        .pumpWidget(MaterialApp(home: ManualExchangeScreen(service: service)));
    await tester.pumpAndSettle();
    expect(find.text('Start a new exchange'), findsOneWidget);
    expect(find.text('Naira to cedis'), findsOneWidget);
    expect(find.text('Recent exchanges'), findsOneWidget);
    expect(find.text('Loading exchange history…'), findsOneWidget);
    expect(tester.getTopLeft(find.text('Recent exchanges')).dy,
        greaterThan(tester.getBottomLeft(find.text('Naira to cedis')).dy));
    expect(service.historyReads, 1);
    service.orders.complete([
      fixtureV1Order(
        status: 'AWAITING_CONFIRMATION',
        hasProof: true,
        remindersEnabled: true,
      ),
    ]);
    await tester.pumpAndSettle();
    expect(find.text('GHS → NGN'), findsOneWidget);
    expect(find.text('Awaiting admin review'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('exchange chooser shows every recent server order',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: ManualExchangeScreen(service: _RecentOrders()),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Awaiting your transfer'), findsOneWidget);
    expect(find.text('Awaiting admin review'), findsOneWidget);
    expect(find.text('Completed'), findsOneWidget);
    expect(find.text('Rejected'), findsOneWidget);
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
      'both exchange directions stay selectable while recovery remains in recent history',
      (tester) async {
    final service = _FakeManualExchangeService(
      enabled: true,
      availableSourceCurrencies: const ['NGN'],
      deliveryPolicyVersion: 1,
      pendingCreate: const ManualExchangeAttempt(
        action: 'create',
        fingerprint:
            '{"sourceCurrency":"NGN","amount":"100.00","settlementMode":"BANK","destinationInstitution":"GCB Bank","destinationAccount":"23312345678","destinationName":"A User"}',
        key: '12345678-1234-4234-8234-123456789012',
        orderId: null,
      ),
    );
    await tester
        .pumpWidget(MaterialApp(home: ManualExchangeScreen(service: service)));
    await tester.pumpAndSettle();
    expect(find.textContaining('bank payout is being updated'), findsNothing);
    expect(find.text('Not available yet'), findsNothing);
    expect(find.text('Incomplete exchange'), findsOneWidget);
    expect(tester.getTopLeft(find.text('Incomplete exchange')).dy,
        greaterThan(tester.getBottomLeft(find.text('Naira to cedis')).dy));
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsWidgets);
    expect(find.text('Enter the amount you want to change.'), findsOneWidget);
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
    expect(find.text('Enter Nigerian bank account number'), findsOneWidget);
    expect(find.text('Your naira goes to your TrustPay wallet.'), findsNothing);
    expect(find.text('TrustPay wallet'), findsNothing);
    expect(find.text('Mobile money'), findsNothing);
    expect(find.text('View transfer account'), findsOneWidget);
  });

  testWidgets(
      'naira payout selects a bank and verifies the account name before continuing',
      (tester) async {
    final service = _FakeManualExchangeService(enabled: true);
    await _openNairaDestination(
      tester,
      service: service,
      kycService: _VerifiedTierOne(),
      authService: _NeedsPinSetup(),
    );

    final bank = find.byKey(const ValueKey('exchange-nigerian-bank-field'));
    final account = find.byKey(const ValueKey('exchange-bank-account-field'));
    expect(tester.getTopLeft(bank).dy, lessThan(tester.getTopLeft(account).dy));
    await _selectNigerianBank(tester, 'Access Bank');
    await tester.enterText(account, '0123456789');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();

    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(find.text('Recipient confirmed'), findsOneWidget);
    expect(
      tester
          .widget<EditableText>(find.descendant(
            of: find
                .byKey(const ValueKey('exchange-nigerian-account-name-field')),
            matching: find.byType(EditableText),
          ))
          .readOnly,
      isTrue,
    );
    final submit = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'View transfer account'));
    expect(submit.onPressed, isNotNull);
    await tester.tap(find.text('View transfer account'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Set transaction PIN'), findsOneWidget);
  });

  testWidgets('naira payout ignores a stale account-name response',
      (tester) async {
    final service = _FakeManualExchangeService(
      enabled: true,
      holdNigerianResolution: true,
    );
    await _openNairaDestination(tester, service: service);
    await _selectNigerianBank(tester, 'Access Bank');
    final account = find.byKey(const ValueKey('exchange-bank-account-field'));
    await tester.enterText(account, '0123456789');
    await tester.pump(const Duration(milliseconds: 500));
    expect(service.nigerianResolveCalls, 1);

    await tester.enterText(account, '0123456780');
    service.pendingNigerianResolution!.complete(
      const ManualNigerianBankResolution(
        accountName: 'Wrong old recipient',
        accountNumber: '0123456789',
        bankCode: '044',
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Wrong old recipient'), findsNothing);
    expect(find.text('Recipient confirmed'), findsNothing);
    expect(
      tester
          .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'View transfer account'))
          .onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('naira payout does not resolve an account before bank selection',
      (tester) async {
    final service = _FakeManualExchangeService(enabled: true);
    await _openNairaDestination(tester, service: service);
    await tester.enterText(
      find.byKey(const ValueKey('exchange-bank-account-field')),
      '0123456789',
    );
    await tester.pump(const Duration(milliseconds: 600));
    expect(service.nigerianResolveCalls, 0);
    expect(find.text('Recipient confirmed'), findsNothing);
  });

  testWidgets('naira payout lookup failure can retry and keeps submit disabled',
      (tester) async {
    final service = _FakeManualExchangeService(
      enabled: true,
      failNigerianResolution: true,
    );
    await _openNairaDestination(tester, service: service);
    await _selectNigerianBank(tester, 'Access Bank');
    await tester.enterText(
      find.byKey(const ValueKey('exchange-bank-account-field')),
      '0123456789',
    );
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();

    expect(find.text('Retry lookup'), findsOneWidget);
    expect(find.text('Recipient confirmed'), findsNothing);
    expect(
      tester
          .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'View transfer account'))
          .onPressed,
      isNull,
    );
    service.failNigerianResolution = false;
    await tester.tap(find.text('Retry lookup'));
    await tester.pumpAndSettle();
    expect(find.text('Ada Lovelace'), findsOneWidget);
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
    expect(find.text('Enter Nigerian bank account number'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('View transfer account'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'direct naira payout validates ten digits and does not apply wallet limits',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
      service: _FakeManualExchangeService(enabled: true),
      kycService: _VerifiedTierOne(),
      authService: _NeedsPinSetup(),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '100000');
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await _selectNigerianBank(tester, 'Access Bank');
    await tester.enterText(
        find.byKey(const ValueKey('exchange-bank-account-field')), '012345678');
    await tester.ensureVisible(find.text('View transfer account'));
    expect(
      tester
          .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'View transfer account'))
          .onPressed,
      isNull,
    );
    await tester.ensureVisible(
        find.byKey(const ValueKey('exchange-bank-account-field')));
    await tester.enterText(
        find.byKey(const ValueKey('exchange-bank-account-field')),
        '0123456789');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
    expect(find.text('Recipient confirmed'), findsOneWidget);
    await tester.ensureVisible(find.text('View transfer account'));
    await tester.tap(find.text('View transfer account'));
    // The submit spinner remains active while the PIN dialog awaits input.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Set transaction PIN'), findsOneWidget);
    expect(find.text('Tier 1 transactions are temporarily unavailable'),
        findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'keeps an unresolved retry in history without replacing the chooser',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
            service: _FakeManualExchangeService(
      enabled: false,
      pendingCreate: const ManualExchangeAttempt(
          action: 'create',
          fingerprint:
              '{"sourceCurrency":"GHS","amount":"100.00","settlementMode":"BANK","destinationInstitution":"Synthetic Nigerian Bank","destinationAccount":"0123456789","destinationName":"Beneficiary","deliveryPolicyVersion":2}',
          key: '12345678-1234-4234-8234-123456789012',
          orderId: null),
    ))));
    await tester.pumpAndSettle();
    expect(find.text('Start a new exchange'), findsOneWidget);
    expect(find.text('Incomplete exchange'), findsOneWidget);
    expect(find.text('Continue saved exchange'), findsOneWidget);
    expect(find.text('Retry exchange'), findsNothing);
    expect(find.text('Synthetic Nigerian Bank'), findsNothing);
    expect(find.text('Your naira goes to your TrustPay wallet.'), findsNothing);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue saved exchange'));
    await tester.pumpAndSettle();
    expect(find.text('Retry exchange'), findsOneWidget);
    expect(find.text('Synthetic Nigerian Bank'), findsOneWidget);
    expect(
        tester
            .widget<TextFormField>(
                find.byKey(const ValueKey('exchange-bank-account-field')))
            .enabled,
        isFalse);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'a suspended verified customer cannot authorize an external exchange',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
            service: _FakeManualExchangeService(enabled: true),
            kycService: _VerifiedTierOne(suspended: true),
            authService: _NeedsPinSetup())));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '100');
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await _selectNigerianBank(tester, 'Access Bank');
    await tester.enterText(
        find.byKey(const ValueKey('exchange-bank-account-field')),
        '0123456789');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('View transfer account'));
    await tester.tap(find.text('View transfer account'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Your account is under review'), findsOneWidget);
    expect(find.text('Set transaction PIN'), findsNothing);
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

  testWidgets('opens a saved pending create from recent exchange history',
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

    expect(find.text('Start a new exchange'), findsOneWidget);
    expect(find.text('Incomplete exchange'), findsOneWidget);
    expect(find.text('Retry exchange'), findsNothing);
    expect(find.text('GCB Bank'), findsNothing);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue saved exchange'));
    await tester.pumpAndSettle();
    expect(find.text('Exchange request pending'), findsOneWidget);
    expect(find.text('Retry exchange'), findsOneWidget);
    expect(find.text('GCB Bank'), findsOneWidget);
    expect(find.text('23312345678'), findsOneWidget);
  });

  testWidgets(
      'recovers an older reverse bank attempt without revalidating its recorded destination as a new order',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
      service: _FakeManualExchangeService(
          enabled: false,
          pendingCreate: const ManualExchangeAttempt(
              action: 'create',
              fingerprint:
                  '{"sourceCurrency":"GHS","amount":"100.00","settlementMode":"BANK","destinationInstitution":"Earlier Bank","destinationAccount":"23312345678","destinationName":"Beneficiary"}',
              key: '12345678-1234-4234-8234-123456789012',
              orderId: null)),
      kycService: _VerifiedTierOne(),
      authService: _NeedsPinSetup(),
    )));
    await tester.pumpAndSettle();
    expect(find.text('Start a new exchange'), findsOneWidget);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue saved exchange'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Retry exchange'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Retry exchange'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Set transaction PIN'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
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
    expect(find.text('Start a new exchange'), findsOneWidget);
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
  bool failNigerianResolution;
  final bool holdNigerianResolution;
  int nigerianResolveCalls = 0;
  Completer<ManualNigerianBankResolution>? pendingNigerianResolution;
  bool enabled;
  int configReads = 0;
  final List<String>? availableSourceCurrencies;
  final ManualExchangeAttempt? pendingCreate;
  final int deliveryPolicyVersion;

  _FakeManualExchangeService(
      {required this.enabled,
      this.pendingCreate,
      this.availableSourceCurrencies,
      this.deliveryPolicyVersion = 2,
      this.failNigerianResolution = false,
      this.holdNigerianResolution = false})
      : super();

  @override
  Future<List<ManualNigerianBankOption>> fetchNigerianBanks() async => const [
        ManualNigerianBankOption(name: 'Access Bank', code: '044'),
        ManualNigerianBankOption(name: 'Zenith Bank', code: '057'),
      ];

  @override
  Future<ManualNigerianBankResolution> resolveNigerianBankAccount({
    required String accountNumber,
    required String bankCode,
  }) async {
    nigerianResolveCalls++;
    if (holdNigerianResolution) {
      pendingNigerianResolution = Completer<ManualNigerianBankResolution>();
      return pendingNigerianResolution!.future;
    }
    if (failNigerianResolution) {
      throw const FormatException('Could not confirm this account name.');
    }
    return ManualNigerianBankResolution(
      accountName: 'Ada Lovelace',
      accountNumber: accountNumber,
      bankCode: bankCode,
    );
  }

  @override
  Future<ManualExchangeConfig> fetchConfig() async {
    configReads++;
    return ManualExchangeConfig.fromJson({
      'enabled': enabled,
      'deliveryPolicyVersion': deliveryPolicyVersion,
      'sourceCurrency': 'NGN',
      'targetCurrency': 'GHS',
      'supportedSourceCurrencies': ['NGN', 'GHS'],
      'settlementOptions': {
        'GHS': ['BANK'],
        'NGN': ['MOMO', 'BANK']
      },
      if (availableSourceCurrencies != null)
        'availableSourceCurrencies': availableSourceCurrencies,
    });
  }

  @override
  Future<List<ManualExchangeOrder>> listOrders() async => const [];

  @override
  Future<ManualExchangeAttempt?> pendingCreateAttempt() async => pendingCreate;
}

class _VerifiedTierOne extends KycService {
  final bool suspended;
  _VerifiedTierOne({this.suspended = false});
  @override
  Future<KycOverview> fetchOverview(
          {bool includeIdentityProfile = false}) async =>
      KycOverview.fromJson({
        'kycStatus': 'VERIFIED',
        'kycTier': 'TIER_1',
        'isSuspended': suspended,
        'tierOneLimits': null,
      });
}

class _NeedsPinSetup extends AuthService {
  @override
  Future<TransactionPinServerStatus> getTransactionPinStatus() async =>
      const TransactionPinServerStatus(
          configured: false,
          pinLength: null,
          resetHoldUntil: null,
          locked: false);
}

class _SlowHistory extends _FakeManualExchangeService {
  _SlowHistory() : super(enabled: true);
  int historyReads = 0;
  final orders = Completer<List<ManualExchangeOrder>>();
  @override
  Future<List<ManualExchangeOrder>> listOrders() {
    historyReads++;
    return orders.future;
  }
}

class _RecentOrders extends _FakeManualExchangeService {
  _RecentOrders() : super(enabled: true);

  @override
  Future<List<ManualExchangeOrder>> listOrders() async => [
        fixtureV1Order(id: 'one', status: 'AWAITING_TRANSFER'),
        fixtureV1Order(id: 'two', status: 'AWAITING_CONFIRMATION'),
        fixtureV1Order(id: 'three', status: 'COMPLETED'),
        fixtureV1Order(id: 'four', status: 'REJECTED'),
      ];
}

Future<void> _openNairaDestination(
  WidgetTester tester, {
  required ManualExchangeService service,
  KycService? kycService,
  AuthService? authService,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: ManualExchangeScreen(
      service: service,
      kycService: kycService,
      authService: authService,
    ),
  ));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Cedis to naira'));
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextFormField).first, '100');
  await tester.ensureVisible(find.text('Continue'));
  await tester.tap(find.text('Continue'));
  await tester.pumpAndSettle();
}

Future<void> _selectNigerianBank(
  WidgetTester tester,
  String bankName,
) async {
  await tester.tap(find.byKey(const ValueKey('exchange-nigerian-bank-field')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(bankName).last);
  await tester.pumpAndSettle();
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
