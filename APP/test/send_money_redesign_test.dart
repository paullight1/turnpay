import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';
import 'package:trustpay_app/features/security/screens/transaction_security_screen.dart';
import 'package:trustpay_app/services/auth_service.dart';
import 'package:trustpay_app/services/payment_attempt_store.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';
import 'support/trustpay_test_api.dart';

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

Finder input(String label) => find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == label);

class _Security extends TransactionSecurityService {
  @override
  Future<TransactionSecurityConfig> getConfig() async =>
      const TransactionSecurityConfig(
          hasPin: true,
          pinLength: 4,
          biometricEnabled: false,
          canUseBiometrics: false,
          hasBiometric: false,
          biometricLabel: 'App unlock');
  @override
  Future<void> saveVerifiedDevicePin(String pin) async {}
}

class _BrokenLookupStore extends PaymentAttemptStore {
  _BrokenLookupStore() : super(storage: MemoryPaymentAttemptStorage());
  @override
  Future<PaymentAttempt?> findUnresolved(
          String userId,
          PaymentAttemptOperation operation,
          Map<String, dynamic> payload) async =>
      throw const PaymentAttemptStoreException('Storage unavailable');
}

class _BrokenPrepareStore extends PaymentAttemptStore {
  _BrokenPrepareStore() : super(storage: MemoryPaymentAttemptStorage());
  @override
  Future<String> prepare(String userId, PaymentAttemptOperation operation,
          Map<String, dynamic> payload) async =>
      throw const PaymentAttemptStoreException('Write unavailable');
}

class _HeldAuth extends AuthService {
  final result = Completer<void>();
  int calls = 0;
  @override
  Future<void> verifyTransactionPin(String pin) {
    calls++;
    return result.future;
  }
}

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });
  setUp(() => setMockSecureStorage());
  for (final state in ['SUCCESS', 'FAILED', 'REVERSED']) {
    testWidgets('startup recovery shows a $state outcome without another send',
        (tester) async {
      final bundle = buildTrustPayTestBundle();
      final store = PaymentAttemptStore(storage: MemoryPaymentAttemptStorage());
      final key = await store.prepare(
          'user-1', PaymentAttemptOperation.internalTransfer, {
        'amount': '25.50',
        'currency': 'NGN',
        'recipientEmail': 'tolu@example.com'
      });
      await store.markSubmitted('user-1', key);
      bundle.dio.interceptors
          .add(InterceptorsWrapper(onRequest: (options, handler) {
        if (options.path == '/api/payment-attempts/resolve') {
          handler.resolve(Response(
              requestOptions: options,
              statusCode: 200,
              data: {'state': state, 'reference': 'IT-RESTORED-001'}));
        } else {
          handler.next(options);
        }
      }));
      await tester.pumpWidget(MaterialApp(
          home: MoneyActionScreen(
              kind: MoneyActionKind.send,
              apiClient: bundle.apiClient,
              paymentAttemptStore: store,
              paymentRecoveryUserId: 'user-1')));
      await tester.pumpAndSettle();
      expect(
          find.textContaining(switch (state) {
            'SUCCESS' => 'Payment confirmed.',
            'FAILED' => 'Payment failed.',
            _ => 'Payment was reversed.',
          }),
          findsOneWidget);
      if (state == 'SUCCESS') {
        expect(find.text('View transfer receipt'), findsOneWidget);
      }
      expect(bundle.adapter.internalTransferMutationCount, 0);
      expect(await store.loadUnresolved('user-1'), isEmpty);
    });
  }
  testWidgets(
      'review waits while a different prior transfer is being recovered',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final store = PaymentAttemptStore(storage: MemoryPaymentAttemptStorage());
    final key = await store.prepare(
        'user-1', PaymentAttemptOperation.internalTransfer, {
      'amount': '10.00',
      'currency': 'NGN',
      'recipientEmail': 'other@example.com'
    });
    await store.markSubmitted('user-1', key);
    final resolver = Completer<void>();
    bundle.dio.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) async {
      if (options.path == '/api/payment-attempts/resolve') {
        await resolver.future;
        handler.resolve(Response(
            requestOptions: options,
            statusCode: 200,
            data: {'state': 'UNKNOWN'}));
      } else {
        handler.next(options);
      }
    }));
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send,
            apiClient: bundle.apiClient,
            paymentAttemptStore: store,
            paymentRecoveryUserId: 'user-1')));
    await tester.pump();
    for (var i = 0; i < 20 && input('Amount').evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.enterText(input('Amount'), '25.50');
    final button =
        find.widgetWithText(FilledButton, 'Checking previous payments…');
    expect(button, findsOneWidget);
    expect(tester.widget<FilledButton>(button).onPressed, isNull);
    resolver.complete();
    await tester.pumpAndSettle();
    expect(find.text('Payment recovery'), findsOneWidget);
    await openTransferRecipient(tester);
    await tester.enterText(input('Recipient email'), 'tolu@example.com');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Review transfer'))
            .onPressed,
        isNotNull);
    expect(bundle.adapter.internalTransferMutationCount, 0);
  });
  testWidgets(
      'a transfer resolved during preflight is shown before a new review',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final store = PaymentAttemptStore(storage: MemoryPaymentAttemptStorage());
    final key = await store.prepare(
        'user-1', PaymentAttemptOperation.internalTransfer, {
      'amount': '25.50',
      'currency': 'NGN',
      'recipientEmail': 'tolu@example.com'
    });
    await store.markSubmitted('user-1', key);
    bundle.dio.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.path == '/api/payment-attempts/resolve') {
        handler.resolve(Response(
            requestOptions: options,
            statusCode: 200,
            data: {'state': 'SUCCESS', 'reference': 'IT-PREFLIGHT-001'}));
      } else {
        handler.next(options);
      }
    }));
    // With no local JWT subject, bootstrap identifies the journal at review time.
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send,
            apiClient: bundle.apiClient,
            paymentAttemptStore: store)));
    await tester.pumpAndSettle();
    await tester.enterText(input('Amount'), '25.50');
    await openTransferRecipient(tester);
    await tester.enterText(input('Recipient email'), 'tolu@example.com');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review transfer'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(
        find.textContaining('Payment confirmed. Reference: IT-PREFLIGHT-001.'),
        findsOneWidget);
    expect(find.text('View transfer receipt'), findsOneWidget);
    expect(bundle.adapter.internalTransferMutationCount, 0);
    expect(find.byType(TransactionPinScreen), findsNothing);
  });
  testWidgets('shared payment recovery also stops a repeated airtime purchase',
      (tester) async {
    final bundle = buildTrustPayTestBundle(includeVtuProviders: true);
    final store = PaymentAttemptStore(storage: MemoryPaymentAttemptStorage());
    final key = await store.prepare(
        'user-1', PaymentAttemptOperation.vtuPurchase, {
      'type': 'airtime',
      'amount': '100.00',
      'currency': 'NGN',
      'phone': '08031234567'
    });
    await store.markSubmitted('user-1', key);
    bundle.dio.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.path == '/api/payment-attempts/resolve') {
        handler.resolve(Response(
            requestOptions: options,
            statusCode: 200,
            data: {'state': 'SUCCESS', 'reference': 'VTU-PREFLIGHT-001'}));
      } else {
        handler.next(options);
      }
    }));
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.airtime,
            apiClient: bundle.apiClient,
            paymentAttemptStore: store)));
    await tester.pumpAndSettle();
    await tester.enterText(input('Phone number'), '08031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    await tester.enterText(input('Amount'), '100');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buy airtime'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(
        find.textContaining('Payment confirmed. Reference: VTU-PREFLIGHT-001.'),
        findsOneWidget);
    expect(find.byType(TransactionPinScreen), findsNothing);
    expect(
        bundle.adapter.requestedUris
            .where((uri) => uri.path == '/api/vtu/purchase'),
        isEmpty);
  });
  testWidgets(
      'disabled transfers keep original payment recovery reachable without another send',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final store = PaymentAttemptStore(storage: MemoryPaymentAttemptStorage());
    final key = await store.prepare(
        'user-1', PaymentAttemptOperation.internalTransfer, {
      'amount': '20.00',
      'currency': 'NGN',
      'recipientEmail': 'tolu@example.com'
    });
    await store.markSubmitted('user-1', key);
    var statusChecks = 0;
    bundle.dio.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.path == '/api/payments/capabilities') {
        handler.resolve(Response(
            requestOptions: options, data: {'internalTransfers': false}));
      } else if (options.path == '/api/payment-attempts/resolve') {
        statusChecks++;
        handler.resolve(Response(
            requestOptions: options,
            data: {'state': 'PENDING', 'reference': 'IT-ORIGINAL'}));
      } else {
        handler.next(options);
      }
    }));
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send,
            apiClient: bundle.apiClient,
            paymentAttemptStore: store,
            paymentRecoveryUserId: 'user-1')));
    await tester.pumpAndSettle();
    expect(input('Amount'), findsNothing);
    expect(find.textContaining('IT-ORIGINAL'), findsNothing);
    await tester.ensureVisible(find.text('Check a previous payment'));
    await tester.tap(find.text('Check a previous payment'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Check status'));
    await tester.tap(find.text('Check status'));
    await tester.pumpAndSettle();
    expect(statusChecks, 2);
    expect(bundle.adapter.internalTransferMutationCount, 0);
  });

  testWidgets(
      'transfer reads the collection endpoint and separates amount from recipient',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    bundle.dio.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.path == '/api/wallets') {
        handler
            .resolve(Response(requestOptions: options, statusCode: 200, data: [
          {'id': 'ngn', 'currency': 'NGN', 'balance': '450.00'},
          {'id': 'ghs', 'currency': 'GHS', 'balance': '0.00'}
        ]));
      } else if (options.path.startsWith('/api/wallets/')) {
        handler.reject(DioException(
            requestOptions: options,
            response: Response(requestOptions: options, statusCode: 404),
            type: DioExceptionType.badResponse));
      } else {
        handler.next(options);
      }
    }));
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send, apiClient: bundle.apiClient)));
    await tester.pumpAndSettle();
    expect(find.text('Available ₦450.00'), findsOneWidget);
    expect(input('Amount'), findsOneWidget);
    expect(input('Recipient email'), findsNothing);
    await tester.enterText(input('Amount'), '20');
    await tester.pump();
    await tester.tap(find.text('Continue to recipient'));
    await tester.pumpAndSettle();
    expect(input('Amount'), findsNothing);
    expect(input('Recipient email'), findsOneWidget);
    expect(bundle.adapter.internalTransferMutationCount, 0);
  });
  testWidgets('send amount updates naira and kobo words while typing',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send, apiClient: bundle.apiClient)));
    await tester.pumpAndSettle();
    await tester.enterText(input('Amount'), '1250.50');
    await tester.pump();
    expect(
        find.text('One thousand, two hundred and fifty naira and fifty kobo'),
        findsOneWidget);
    await tester.enterText(input('Amount'), '0');
    await tester.pump();
    expect(find.textContaining('fifty kobo'), findsNothing);
  });
  testWidgets('a GHS outage does not discard a usable NGN transfer balance',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    bundle.dio.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.path == '/api/wallets/GHS') {
        handler.reject(DioException(
            requestOptions: options,
            response: Response(requestOptions: options, statusCode: 503),
            type: DioExceptionType.badResponse));
      } else {
        handler.next(options);
      }
    }));
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.withdraw, apiClient: bundle.apiClient)));
    await tester.pumpAndSettle();
    await tester.enterText(input('Amount'), '1000');
    await tester.pump();
    expect(find.text('Available ₦125,000.50'), findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Continue to bank details'))
            .onPressed,
        isNotNull);
  });
  testWidgets(
      'preflight storage failure recovers the form without requesting a PIN or sending',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send,
            apiClient: bundle.apiClient,
            transactionSecurityService: _Security(),
            paymentAttemptStore: _BrokenLookupStore())));
    await tester.pumpAndSettle();
    await tester.enterText(input('Amount'), '25.50');
    await openTransferRecipient(tester);
    await tester.enterText(input('Recipient email'), 'tolu@example.com');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review transfer'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
        find.text(
            'Payment protection could not be checked. Try again before sending.'),
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
      'wrong PIN does not send and a corrected PIN opens a receipt once',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send,
            apiClient: bundle.apiClient,
            transactionSecurityService: _Security())));
    await tester.pumpAndSettle();
    await tester.enterText(input('Amount'), '25.50');
    await openTransferRecipient(tester);
    await tester.enterText(input('Recipient email'), 'tolu@example.com');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review transfer'));
    await tester.pumpAndSettle();
    expect(bundle.adapter.internalTransferMutationCount, 0);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('To Tolu A.'), findsOneWidget);
    expect(find.text('₦25.50'), findsOneWidget);
    for (final digit in ['1', '1', '1', '1']) {
      await tester.ensureVisible(find.text(digit));
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(find.text('Incorrect transaction PIN. Try again.'), findsOneWidget);
    expect(bundle.adapter.internalTransferMutationCount, 0);
    await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Retry'));
    await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    for (final digit in ['2', '4', '6', '8']) {
      await tester.ensureVisible(find.text(digit));
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(bundle.adapter.internalTransferMutationCount, 1);
    expect(find.text('Transfer receipt'), findsWidgets);
    expect(find.text('Money sent'), findsOneWidget);
    expect(find.text('New balance'), findsNothing);
    expect(find.text('Share'), findsOneWidget);
  });

  testWidgets(
      'failed attempt preparation does not send or leave the form locked',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.send,
            apiClient: bundle.apiClient,
            transactionSecurityService: _Security(),
            paymentAttemptStore: _BrokenPrepareStore())));
    await tester.pumpAndSettle();
    await tester.enterText(input('Amount'), '25.50');
    await openTransferRecipient(tester);
    await tester.enterText(input('Recipient email'), 'tolu@example.com');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review transfer'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    for (final digit in ['2', '4', '6', '8']) {
      await tester.ensureVisible(find.text(digit));
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(bundle.adapter.internalTransferMutationCount, 0);
    expect(
        find.text(
            'Payment protection could not prepare the transfer. No transfer request was sent. Try again.'),
        findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Review transfer'))
            .onPressed,
        isNotNull);
  });

  testWidgets(
      'PIN keypad cannot launch another verification while the first is in flight',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final auth = _HeldAuth();
    await tester.pumpWidget(MaterialApp(
        home: TransactionPinScreen.verify(
            pinLength: 4,
            title: 'Confirm transfer',
            subtitle: 'Confirm ₦25.50 to Tolu A.',
            securityService: _Security(),
            authService: auth)));
    for (final digit in ['2', '4', '6', '8']) {
      await tester.tap(find.text(digit));
      await tester.pump();
    }
    await tester.tap(find.byIcon(Icons.backspace_outlined));
    await tester.pump();
    await tester.tap(find.text('8'));
    await tester.pump();
    expect(auth.calls, 1);
    await tester.pumpWidget(const SizedBox());
    auth.result.complete();
    await tester.pump();
  });
}
