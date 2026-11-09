import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/services/auth_service.dart';

import 'package:trustpay_app/features/exchange/screens/manual_exchange_screen.dart';
import 'package:trustpay_app/features/exchange/screens/manual_exchange_order_screen.dart';
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
    expect(find.text('GHS 100.00 → NGN 10000.00'), findsOneWidget);
    expect(find.text('EX-FIXTURE-001'), findsNothing);
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
      availableSourceCurrencies: const ['GHS', 'NGN'],
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
    expect(find.text('Temporarily unavailable'), findsNothing);
    expect(find.text('Incomplete'), findsOneWidget);
    expect(tester.getTopLeft(find.text('Incomplete')).dy,
        greaterThan(tester.getBottomLeft(find.text('Naira to cedis')).dy));
    await tester.tap(find.text('Cedis to naira'));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsWidgets);
    expect(find.text('Enter the amount you want to change.'), findsOneWidget);
  });

  testWidgets('users can still explicitly save and resume several drafts',
      (tester) async {
    final service = _FakeManualExchangeService(
      enabled: true,
      deliveryPolicyVersion: 1,
      availableSourceCurrencies: const ['GHS', 'NGN'],
    );
    await tester
        .pumpWidget(MaterialApp(home: ManualExchangeScreen(service: service)));
    await tester.pumpAndSettle();
    for (final amount in ['150', '275']) {
      await tester.tap(find.text('Cedis to naira'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, amount);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Save for later'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save for later'));
      await tester.pumpAndSettle();
    }
    expect(find.text('GHS 150'), findsOneWidget);
    expect(find.text('GHS 275'), findsOneWidget);
    expect(find.text('Incomplete'), findsNWidgets(2));
    await tester.ensureVisible(find.text('GHS 150'));
    await tester.tap(find.text('GHS 150'));
    await tester.pumpAndSettle();
    expect(find.text('150'), findsOneWidget);
    expect(find.text('View transfer account'), findsNothing);
    expect(find.text('Save for later'), findsOneWidget);
  });

  testWidgets(
      'Continue preserves details until transfer is ready and opens review',
      (tester) async {
    final service = _CompletesExchange();
    final router = GoRouter(routes: [
      GoRoute(
        path: '/',
        builder: (_, __) => ManualExchangeScreen(
          service: service,
          authService: _ConfiguredPin(),
        ),
      ),
      GoRoute(
        path: '/exchange/orders/:id',
        builder: (_, state) => ManualExchangeOrderScreen(
          orderId: state.pathParameters['id']!,
          initialOrder: state.extra as ManualExchangeOrder?,
          service: service,
          pickReceipt: () async => ManualExchangeProofFile(
            fileName: 'receipt.png',
            contentType: 'image/png',
            bytes: Uint8List.fromList([137, 80, 78, 71]),
          ),
        ),
      ),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(
        MaterialApp.router(theme: AppTheme.light, routerConfig: router));
    await tester.pumpAndSettle();
    Future<void> press(String label) async {
      final target = find.text(label);
      if (target.evaluate().isEmpty) {
        await tester.scrollUntilVisible(target, 180,
            scrollable: find.byType(Scrollable).first);
      }
      await tester.ensureVisible(target);
      await tester.pumpAndSettle();
      await tester.tap(target);
      await tester.pumpAndSettle();
    }

    await press('Cedis to naira');
    await tester.enterText(find.byType(TextFormField).first, '100.00');
    await press('Continue');
    expect(find.text('Receive naira'), findsOneWidget);
    expect(service.drafts, isEmpty);
    await _selectNigerianBank(tester, 'Access Bank');
    await tester.enterText(
        find.byKey(const ValueKey('exchange-bank-account-field')),
        '0123456789');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();

    await press('View transfer account');
    expect(
        find.textContaining('Cedis to naira is being updated'), findsOneWidget);
    expect(find.textContaining('Your details are still here'), findsOneWidget);
    expect(find.text('0123456789'), findsOneWidget);
    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(service.order, isNull);
    expect(service.drafts, isEmpty);

    service.deliveryPolicyVersion = 2;
    await press('View transfer account');
    Navigator.of(tester.element(find.text('Enter your transaction PIN')))
        .pop('2468');
    await tester.pumpAndSettle();
    expect(find.text('Collection Bank'), findsOneWidget);
    expect(find.text('EX-FIXTURE-001'), findsWidgets);
    await press('I’ve made this transfer');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Name on receipt'), 'Alex Morgan');
    await press('Upload receipt');
    final confirmation = find.byType(CheckboxListTile);
    await tester.ensureVisible(confirmation);
    await tester.tap(confirmation);
    await tester.pumpAndSettle();
    await press('Confirm payment & submit receipt');
    expect(find.text('Awaiting admin review'), findsOneWidget);
    expect(
        service.order!.status, ManualExchangeOrderStatus.awaitingConfirmation);
    expect(service.drafts, isEmpty);
    await tester.pumpWidget(const SizedBox());
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
      'direct naira payout validates ten digits without requiring a wallet tier',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
      service: _FakeManualExchangeService(enabled: true),
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
    expect(find.text('Incomplete'), findsOneWidget);
    expect(find.text('GHS 100.00'), findsOneWidget);
    expect(find.text('GHS → NGN'), findsOneWidget);
    expect(find.text('Continue saved request'), findsNothing);
    expect(find.text('Synthetic Nigerian Bank'), findsNothing);
    expect(find.text('Your naira goes to your TrustPay wallet.'), findsNothing);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Incomplete'));
    await tester.pumpAndSettle();
    expect(find.text('Continue saved request'), findsOneWidget);
    expect(find.text('Receive NGN · Synthetic Nigerian Bank'), findsOneWidget);
    expect(find.text('Account ending in 6789'), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('a committed saved request opens its original order directly',
      (tester) async {
    final service = _FakeManualExchangeService(
      enabled: true,
      pendingCreate: const ManualExchangeAttempt(
        action: 'create',
        fingerprint: '{"amount":"100.00","settlementMode":"WALLET"}',
        key: '12345678-1234-4234-8234-123456789012',
        orderId: null,
      ),
    )..recoveredOrder =
        fixtureV1Order(id: 'original', status: 'AWAITING_TRANSFER');
    final router = GoRouter(routes: [
      GoRoute(
          path: '/',
          builder: (_, __) => ManualExchangeScreen(service: service)),
      GoRoute(
          path: '/exchange/orders/:id',
          builder: (_, state) =>
              Scaffold(body: Text('Order ${state.pathParameters['id']}'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Incomplete'));
    await tester.tap(find.text('Incomplete'));
    await tester.pumpAndSettle();
    expect(find.text('Order original'), findsOneWidget);
    expect(find.text('Continue saved request'), findsNothing);
  });

  testWidgets(
      'an external exchange reaches PIN setup without an identity check',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: ManualExchangeScreen(
            service: _FakeManualExchangeService(enabled: true),
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
    expect(find.text('Set transaction PIN'), findsOneWidget);
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
    expect(find.text('Incomplete'), findsOneWidget);
    expect(find.text('Continue saved request'), findsNothing);
    expect(find.text('GCB Bank'), findsNothing);
    expect(find.text('NGN 100.00'), findsOneWidget);
    expect(find.text('NGN → GHS'), findsOneWidget);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Incomplete'));
    await tester.pumpAndSettle();
    expect(find.text('Resume exchange'), findsOneWidget);
    expect(find.text('Continue saved request'), findsOneWidget);
    expect(find.text('Receive GHS · GCB Bank'), findsOneWidget);
    expect(find.text('Account ending in 5678'), findsOneWidget);
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
      authService: _NeedsPinSetup(),
    )));
    await tester.pumpAndSettle();
    expect(find.text('Start a new exchange'), findsOneWidget);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Incomplete'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Continue saved request'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue saved request'));
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
  int deliveryPolicyVersion;

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

  ManualExchangeOrder? recoveredOrder;

  @override
  Future<ManualExchangeOrder?> recoverCreatedOrder(
          ManualExchangeAttempt attempt) async =>
      recoveredOrder;

  final drafts = <ManualExchangeAttempt>[];

  @override
  Future<void> saveAmountDraft(String currency, String amount,
      {ManualExchangeAttempt? previous}) async {
    drafts.remove(previous);
    drafts.add(ManualExchangeAttempt(
      action: 'draft',
      fingerprint: jsonEncode({'sourceCurrency': currency, 'amount': amount}),
      key: 'draft-${drafts.length}',
      orderId: null,
    ));
  }

  @override
  Future<List<ManualExchangeAttempt>> pendingCreateAttempts() async =>
      [if (pendingCreate != null) pendingCreate!, ...drafts];
}

class _ConfiguredPin extends AuthService {
  @override
  Future<TransactionPinServerStatus> getTransactionPinStatus() async =>
      const TransactionPinServerStatus(
        configured: true,
        pinLength: 4,
        resetHoldUntil: null,
        locked: false,
      );
}

class _CompletesExchange extends _FakeManualExchangeService {
  _CompletesExchange() : super(enabled: true, deliveryPolicyVersion: 1);

  ManualExchangeOrder? order;

  @override
  Future<ManualExchangeOrder> createOrder({
    String sourceCurrency = 'NGN',
    required String amount,
    required ManualSettlementMode settlementMode,
    required String transactionPin,
    String? destinationInstitution,
    String? destinationAccount,
    String? destinationName,
  }) async {
    expect(sourceCurrency, 'GHS');
    expect(amount, '100.00');
    expect(settlementMode, ManualSettlementMode.bank);
    expect(transactionPin, '2468');
    expect(destinationAccount, '0123456789');
    expect(destinationName, 'Ada Lovelace');
    return order = fixtureV1Order();
  }

  @override
  Future<ManualExchangeOrder> getOrder(String orderId) async => order!;

  @override
  Future<bool> receiptStepStarted(String orderId) async => false;

  @override
  Future<void> markReceiptStepStarted(String orderId) async {}

  @override
  Future<void> clearReceiptStep(String orderId) async {}

  @override
  Future<ManualExchangeOrder> submitProof({
    required String orderId,
    required ManualExchangeProofFile file,
    String? bankReference,
    String? receiptName,
  }) async {
    expect(orderId, order!.id);
    expect(receiptName, 'Alex Morgan');
    expect(bankReference, isEmpty);
    return order =
        fixtureV1Order(status: 'AWAITING_CONFIRMATION', hasProof: true);
  }
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
  AuthService? authService,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: ManualExchangeScreen(
      service: service,
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
