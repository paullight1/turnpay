import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:go_router/go_router.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';
import 'support/trustpay_test_api.dart';
import 'package:trustpay_app/features/home/screens/send_money_entry_screen.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

Future<void> openTransferRecipient(WidgetTester tester) async {
  await tester.pump();
  final next = find.text('Continue to recipient');
  if (next.evaluate().isEmpty) return;
  final amount = find.byWidgetPredicate(
      (w) => w is TextField && w.decoration?.labelText == 'Amount');
  if (tester.widget<TextField>(amount).controller!.text.isEmpty) {
    await tester.enterText(amount, '20');
    await tester.pump();
  }
  await tester.tap(next);
  await tester.pumpAndSettle();
}

Finder field(String label) => find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.labelText == label);

bool get captureTransfers =>
    Platform.environment['TRUSTPAY_TRANSFER_CAPTURE'] == '1';

Future<TrustPayTestBundle> renderTransfer(WidgetTester tester,
    {MoneyActionKind kind = MoneyActionKind.withdraw,
    GlobalKey? capture,
    Size size = const Size(390, 844),
    bool dark = false,
    double scale = 1,
    WithdrawPrefill? prefill,
    void Function(RequestOptions, RequestInterceptorHandler)?
        intercept}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
  setMockSecureStorage();
  final bundle = buildTrustPayTestBundle();
  if (intercept != null) {
    bundle.dio.interceptors.add(InterceptorsWrapper(onRequest: intercept));
  }
  await tester.pumpWidget(RepaintBoundary(
      key: capture,
      child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: dark ? AppTheme.dark : AppTheme.light,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(scale)),
              child: child!),
          home: MoneyActionScreen(
              kind: kind,
              apiClient: bundle.apiClient,
              transactionSecurityService: _TransferTestSecurity(),
              withdrawPrefill: prefill))));
  await tester.pumpAndSettle();
  return bundle;
}

Future<void> bankDetails(WidgetTester tester) async {
  await tester.enterText(field('Amount'), '1000');
  await tester.pumpAndSettle();
  await tester.tap(find.text('Continue to bank details'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Choose bank'));
  await tester.pumpAndSettle();
  await tester.enterText(field('Search banks'), 'gtb');
  await tester.pumpAndSettle();
  await tester.tap(find.text('GTBank'));
  await tester.pumpAndSettle();
}

Future<void> snapshot(WidgetTester tester, GlobalKey key, String name) async {
  if (!captureTransfers) return;
  await tester
      .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 750)));
  await tester.pumpAndSettle();
  await tester
      .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 250)));
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final picture = await boundary.toImage(pixelRatio: 2);
    final bytes = await picture.toByteData(format: ui.ImageByteFormat.png);
    final file = File('../output/transfer-ui/$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(bytes!.buffer.asUint8List());
    picture.dispose();
  });
}

void main() {
  testWidgets(
      'older Paystack servers allow recipient preparation without enabling withdrawals',
      (tester) async {
    await renderTransfer(tester, intercept: (options, handler) {
      if (options.path == '/api/payments/capabilities') {
        handler.resolve(Response(requestOptions: options, data: {
          'provider': 'paystack',
          'configured': true,
          'withdrawals': false
        }));
      } else {
        handler.next(options);
      }
    });
    expect(find.text('Continue to bank details'), findsOneWidget);
  });
  testWidgets(
      'recipient preparation works before bank transfers are activated without enabling payment',
      (tester) async {
    final bundle = await renderTransfer(tester, intercept: (options, handler) {
      if (options.path == '/api/payments/capabilities') {
        handler.resolve(Response(requestOptions: options, data: {
          'configured': true,
          'bankTransferPreparation': true,
          'withdrawals': false
        }));
      } else {
        handler.next(options);
      }
    });
    expect(find.text('Continue to bank details'), findsOneWidget);
    await bankDetails(tester);
    await tester.enterText(field('Account number'), '0123456789');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(find.text('Recipient confirmed'), findsOneWidget);
    expect(
        find.text(
            'Bank transfers are being prepared. You can check your recipient details now.'),
        findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(find.widgetWithText(
                FilledButton, 'Transfers temporarily unavailable'))
            .onPressed,
        isNull);
    expect(
        bundle.adapter.requestedUris
            .any((u) => u.path == '/api/payments/withdraw'),
        isFalse);
  });
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    await GoogleFonts.pendingFonts([AppTheme.light.textTheme]);
    if (!captureTransfers) return;
    final icons = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await icons.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await icons.readAsBytes()))))
          .load();
    }
  });

  testWidgets('editing a recipient invalidates an in-flight name immediately',
      (tester) async {
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle();
    RequestOptions? pending;
    RequestInterceptorHandler? resolve;
    bundle.dio.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.path == '/api/transfers/recipient/preview') {
        pending = options;
        resolve = handler;
      } else {
        handler.next(options);
      }
    }));
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send, apiClient: bundle.apiClient)));
    await tester.pumpAndSettle();
    await openTransferRecipient(tester);
    await tester.enterText(field('Recipient email'), 'old@example.com');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pump();
    expect(resolve, isNotNull);
    await openTransferRecipient(tester);
    await tester.enterText(field('Recipient email'), 'invalid');
    resolve!.resolve(Response(requestOptions: pending!, data: {
      'found': true,
      'displayName': 'Old User',
      'maskedIdentifier': 'o***@example.com',
    }));
    await tester.pumpAndSettle();
    expect(find.textContaining('Old User'), findsNothing);
    final submit = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Review transfer'));
    expect(submit.onPressed, isNull);
  });
  testWidgets('a ten-digit bank account resolves a real name before review',
      (tester) async {
    final key = GlobalKey();
    final bundle = await renderTransfer(tester, capture: key);
    expect(find.text('Available ₦125,000.50'), findsOneWidget);
    await snapshot(tester, key, 'bank-amount');
    await bankDetails(tester);
    await tester.enterText(field('Account number'), '0123456789');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(find.text('Recipient confirmed'), findsOneWidget);
    await snapshot(tester, key, 'bank-recipient');
    await tester.tap(find.text('Review transfer'));
    for (var i = 0;
        i < 30 && find.byType(BottomSheet).evaluate().isEmpty;
        i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.text('Name'), findsOneWidget);
    expect(
        bundle.adapter.requestedUris
            .any((u) => u.path == '/api/payments/withdraw'),
        isFalse);
    await snapshot(tester, key, 'bank-review');
  });

  testWidgets(
      'editing an account invalidates its pending verification immediately',
      (tester) async {
    RequestOptions? pending;
    RequestInterceptorHandler? held;
    var lookups = 0;
    await renderTransfer(tester, intercept: (options, handler) {
      if (options.path == '/api/payments/banks/resolve') {
        lookups++;
        if (lookups == 1) {
          pending = options;
          held = handler;
        } else {
          handler.resolve(Response(requestOptions: options, data: {
            'accountName': 'Grace Hopper',
            'accountNumber': (options.data as Map)['accountNumber'],
            'bankCode': '058'
          }));
        }
      } else {
        handler.next(options);
      }
    });
    await bankDetails(tester);
    await tester.enterText(field('Account number'), '0123456789');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();
    expect(held, isNotNull);
    await tester.enterText(field('Account number'), '012345678');
    held!.resolve(Response(requestOptions: pending!, data: {
      'accountName': 'Wrong old recipient',
      'accountNumber': '0123456789',
      'bankCode': '058'
    }));
    await tester.pumpAndSettle();
    expect(find.text('Wrong old recipient'), findsNothing);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Review transfer'))
            .onPressed,
        isNull);
    await tester.enterText(field('Account number'), '0123456780');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(find.text('Grace Hopper'), findsOneWidget);
  });

  testWidgets('empty account-name responses remain unverified and can retry',
      (tester) async {
    var empty = true;
    await renderTransfer(tester, intercept: (options, handler) {
      if (options.path == '/api/payments/banks/resolve' && empty) {
        handler.resolve(
            Response(requestOptions: options, data: {'accountName': ''}));
      } else {
        handler.next(options);
      }
    });
    await bankDetails(tester);
    await tester.enterText(field('Account number'), '0123456789');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(find.text('Recipient confirmed'), findsNothing);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Review transfer'))
            .onPressed,
        isNull);
    empty = false;
    await tester.ensureVisible(find.text('Retry lookup'));
    await tester.tap(find.text('Retry lookup'));
    await tester.pumpAndSettle();
    expect(find.text('Ada Lovelace'), findsOneWidget);
  });

  testWidgets('an unavailable bank list cannot enable a manually entered name',
      (tester) async {
    await renderTransfer(tester, intercept: (options, handler) {
      if (options.path.endsWith('/banks')) {
        handler.reject(DioException(
            requestOptions: options,
            response: Response(requestOptions: options, statusCode: 503),
            type: DioExceptionType.badResponse));
      } else {
        handler.next(options);
      }
    });
    await tester.enterText(field('Amount'), '1000');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to bank details'));
    await tester.pumpAndSettle();
    await tester.enterText(field('Account number'), '0123456789');
    await tester.pumpAndSettle();
    expect(field('Account name'), findsNothing);
    expect(find.text('Reload bank list'), findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Review transfer'))
            .onPressed,
        isNull);
  });

  testWidgets('amount validation compares exact balance cents', (tester) async {
    await renderTransfer(tester);
    await tester.enterText(field('Amount'), '125000.51');
    await tester.pumpAndSettle();
    expect(find.text('Amount exceeds your available NGN balance.'),
        findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Continue to bank details'))
            .onPressed,
        isNull);
    await tester.enterText(field('Amount'), '125000.50');
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Continue to bank details'))
            .onPressed,
        isNotNull);
  });

  testWidgets('unavailable balance blocks payment until a successful refresh',
      (tester) async {
    var unavailable = true;
    await renderTransfer(tester, intercept: (options, handler) {
      if (options.path == '/api/wallets' && unavailable) {
        handler.reject(DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response(requestOptions: options, statusCode: 503)));
      } else {
        handler.next(options);
      }
    });
    await tester.enterText(field('Amount'), '1000');
    await tester.pumpAndSettle();
    expect(find.text('Refresh your wallet balance before continuing.'),
        findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Continue to bank details'))
            .onPressed,
        isNull);
    unavailable = false;
    await tester.tap(find.byTooltip('Refresh balance'));
    await tester.pumpAndSettle();
    expect(find.text('Available ₦125,000.50'), findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Continue to bank details'))
            .onPressed,
        isNotNull);
    await tester.enterText(field('Amount'), '1250.50');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to bank details'));
    await tester.pumpAndSettle();
    expect(find.text('₦1,250.50'), findsOneWidget);
  });

  testWidgets('bank search stays usable with the small-phone keyboard open',
      (tester) async {
    await renderTransfer(tester, size: const Size(320, 740), scale: 1.5);
    await tester.enterText(field('Amount'), '1000');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to bank details'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Choose bank'));
    await tester.pumpAndSettle();
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpAndSettle();
    await tester.enterText(field('Search banks'), 'gtb');
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('GTBank'));
    await tester.pumpAndSettle();
    expect(field('Search banks'), findsNothing);
    expect(find.text('GTBank'), findsOneWidget);
  });

  testWidgets('destination choice opens the bank form without destination tabs',
      (tester) async {
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(
        MaterialApp(home: SendMoneyEntryScreen(apiClient: bundle.apiClient)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bank account'));
    await tester.pumpAndSettle();
    expect(find.text('Bank transfer'), findsOneWidget);
    expect(find.text('Continue to bank details'), findsOneWidget);
    expect(find.text('TrustPay'), findsNothing);
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Where are you sending money?'), findsOneWidget);
    await tester.tap(find.text('TrustPay'));
    await tester.pumpAndSettle();
    expect(field('Amount'), findsOneWidget);
    expect(field('Recipient email'), findsNothing);
  });

  testWidgets('a failed security check unlocks the form without sending money',
      (tester) async {
    final bundle = await renderTransfer(tester, kind: MoneyActionKind.send,
        intercept: (options, handler) {
      if (options.path == '/api/auth/transaction-pin/status') {
        handler.reject(DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response(requestOptions: options, statusCode: 503)));
      } else {
        handler.next(options);
      }
    });
    await tester.enterText(field('Amount'), '1000');
    await openTransferRecipient(tester);
    await tester.enterText(field('Recipient email'), 'tolu@example.com');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review transfer'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Could not check your transaction security. Try again.'),
        findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Review transfer'))
            .onPressed,
        isNotNull);
    expect(bundle.adapter.internalTransferMutationCount, 0);
  });

  testWidgets(
      'verified bank transfer sends once after PIN and opens its receipt',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle(transactionPinConfigured: true);
    final sent = <RequestOptions>[];
    bundle.dio.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.path == '/api/payments/withdraw') {
        sent.add(options);
        handler.resolve(Response(requestOptions: options, data: {
          'status': 'SUCCESS',
          'reference': 'BANK-TEST-001',
          'amount': '1000.00',
          'currency': 'NGN'
        }));
      } else {
        handler.next(options);
      }
    }));
    final router = GoRouter(initialLocation: '/withdraw', routes: [
      GoRoute(
          path: '/withdraw',
          builder: (_, __) => MoneyActionScreen(
              kind: MoneyActionKind.withdraw,
              apiClient: bundle.apiClient,
              transactionSecurityService: _TransferTestSecurity())),
      GoRoute(
          path: '/withdraw/success',
          builder: (_, state) => Scaffold(
              body: Text('Bank receipt ${(state.extra as Map)['reference']}'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    await bankDetails(tester);
    await tester.enterText(field('Account number'), '0123456789');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review transfer'));
    await tester.pumpAndSettle();
    expect(sent, isEmpty);
    expect(tester.widget<TextField>(field('Account number')).enabled, isFalse);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(sent, isEmpty);
    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(sent, hasLength(1));
    expect(sent.single.data, containsPair('amount', '1000.00'));
    expect(sent.single.data, containsPair('bankCode', '058'));
    expect(sent.single.data, containsPair('accountNumber', '0123456789'));
    expect(sent.single.data, containsPair('accountName', 'Ada Lovelace'));
    expect(sent.single.data, containsPair('provider', 'paystack'));
    expect(sent.single.headers['Idempotency-Key'], isNotEmpty);
    expect(find.text('Bank receipt BANK-TEST-001'), findsOneWidget);
  });

  for (final kind in [MoneyActionKind.send, MoneyActionKind.withdraw]) {
    testWidgets(
        '$kind disabled feature shows one explanation without a retry loop or amount form',
        (tester) async {
      final bundle = await renderTransfer(tester, kind: kind,
          intercept: (options, handler) {
        if (options.path == '/api/payments/capabilities') {
          handler.resolve(Response(
              requestOptions: options,
              data: {'internalTransfers': false, 'withdrawals': false}));
        } else {
          handler.next(options);
        }
      });
      expect(
          find.text(kind == MoneyActionKind.send
              ? 'TrustPay transfers are unavailable'
              : 'Bank transfers are unavailable'),
          findsOneWidget);
      expect(field('Amount'), findsNothing);
      expect(find.text('Retry'), findsNothing);
      expect(find.text('Contact support'), findsOneWidget);
      expect(bundle.adapter.internalTransferMutationCount, 0);
      expect(
          bundle.adapter.requestedUris
              .where((u) => u.path == '/api/payments/withdraw'),
          isEmpty);
    });
  }
  testWidgets(
      'a capability loading failure offers retry and restores the bank form after recovery',
      (tester) async {
    var failing = true;
    await renderTransfer(tester, intercept: (options, handler) {
      if (options.path == '/api/payments/capabilities' && failing) {
        handler.reject(DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response(requestOptions: options, statusCode: 503)));
      } else {
        handler.next(options);
      }
    });
    expect(find.text('Couldn’t load bank transfers'), findsOneWidget);
    expect(field('Amount'), findsNothing);
    failing = false;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(field('Amount'), findsOneWidget);
    expect(find.text('Available ₦125,000.50'), findsOneWidget);
  });

  testWidgets('saved beneficiaries still collect an amount before payment',
      (tester) async {
    await renderTransfer(tester,
        prefill: const WithdrawPrefill(
            beneficiaryId: 'saved-recipient',
            bankCode: '058',
            bankName: 'GTBank',
            accountName: 'Ada Lovelace',
            accountNumberMasked: '******6789'));
    expect(field('Amount'), findsOneWidget);
    await tester.enterText(field('Amount'), '1000');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to bank details'));
    await tester.pumpAndSettle();
    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(field('Account number'), findsNothing);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Review transfer'))
            .onPressed,
        isNotNull);
  });

  testWidgets('changing banks rejects the previous banks late lookup',
      (tester) async {
    RequestOptions? oldRequest;
    RequestInterceptorHandler? oldHandler;
    await renderTransfer(tester, intercept: (options, handler) {
      if (options.path == '/api/payments/banks/resolve') {
        final data = options.data as Map;
        if (data['bankCode'] == '058') {
          oldRequest = options;
          oldHandler = handler;
        } else {
          handler.resolve(Response(requestOptions: options, data: {
            'accountName': 'Current Bank Recipient',
            'accountNumber': data['accountNumber'],
            'bankCode': data['bankCode']
          }));
        }
      } else {
        handler.next(options);
      }
    });
    await bankDetails(tester);
    await tester.enterText(field('Account number'), '0123456789');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();
    expect(oldHandler, isNotNull);
    await tester.tap(find.text('GTBank'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    await tester.ensureVisible(find.text('Access Bank'));
    await tester.tap(find.text('Access Bank'));
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    oldHandler!.resolve(Response(requestOptions: oldRequest!, data: {
      'accountName': 'Previous Bank Recipient',
      'accountNumber': '0123456789',
      'bankCode': '058'
    }));
    await tester.pumpAndSettle();
    expect(find.text('Current Bank Recipient'), findsOneWidget);
    expect(find.text('Previous Bank Recipient'), findsNothing);
  });

  testWidgets('bank recipient layout supports large text on a small phone',
      (tester) async {
    final key = GlobalKey();
    await renderTransfer(tester,
        capture: key, size: const Size(320, 740), dark: true, scale: 1.5);
    await bankDetails(tester);
    await tester.enterText(field('Account number'), '0123456789');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Recipient confirmed'));
    await tester.pumpAndSettle();
    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await snapshot(tester, key, 'bank-recipient-320-dark');
  });

  for (final dark in [false, true]) {
    for (final small in [false, true]) {
      testWidgets('transfer layout dark=$dark small=$small supports large text',
          (tester) async {
        final key = GlobalKey();
        await renderTransfer(tester,
            kind: MoneyActionKind.send,
            capture: key,
            dark: dark,
            size: small ? const Size(320, 740) : const Size(390, 844),
            scale: small ? 1.5 : 1);
        await tester.enterText(field('Amount'), '1250.50');
        await openTransferRecipient(tester);
        await tester.enterText(field('Recipient email'), 'tolu@example.com');
        await tester.pump(const Duration(milliseconds: 600));
        await tester.pumpAndSettle();
        expect(find.text('Tolu A. • t***@example.com'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.text('Who are you sending to?'));
        await tester.pumpAndSettle();
        await snapshot(tester, key,
            'trustpay-${small ? '320' : '390'}-${dark ? 'dark' : 'light'}');
        tester.view.viewInsets = const FakeViewPadding(bottom: 260);
        addTearDown(tester.view.resetViewInsets);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final footer = find.widgetWithText(FilledButton, 'Review transfer');
        expect(tester.getBottomRight(footer).dy,
            lessThanOrEqualTo((small ? 740 : 844) - 260));
      });
    }
  }
}

class _TransferTestSecurity extends TransactionSecurityService {
  @override
  Future<TransactionSecurityConfig> getConfig() async =>
      const TransactionSecurityConfig(
          hasPin: true,
          pinLength: 4,
          biometricEnabled: false,
          canUseBiometrics: false,
          hasBiometric: false,
          biometricLabel: 'Biometric approval');
  @override
  Future<void> saveVerifiedDevicePin(String pin) async {}
}
