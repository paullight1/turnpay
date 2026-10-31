import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';
import 'package:trustpay_app/services/paystack_checkout_recovery.dart';
import 'package:trustpay_app/services/wallet_service.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PaystackCheckoutAttemptStore', () {
    test('reuses the same account-scoped key for an unresolved amount',
        () async {
      final storage = MemoryPaystackCheckoutStorage();
      final firstStore = PaystackCheckoutAttemptStore(
        storage: storage,
        keyGenerator: () => 'checkout-key-1',
      );

      final first = await firstStore.prepare(
        userId: 'user-1',
        amount: '00050',
        currency: 'NGN',
      );
      final secondStore = PaystackCheckoutAttemptStore(
        storage: storage,
        keyGenerator: () => 'checkout-key-2',
      );
      final replay = await secondStore.prepare(
        userId: 'user-1',
        amount: '50.00',
        currency: 'ngn',
      );

      expect(first.attemptKey, 'checkout-key-1');
      expect(replay.attemptKey, first.attemptKey);
      expect(replay.amount, '50.00');
      expect(await secondStore.findUnresolved('user-2'), isNull);
      expect(storage.values.values.single, isNot(contains('2468')));
    });

    test('persists a pending reference for restart recovery', () async {
      final storage = MemoryPaystackCheckoutStorage();
      final store = PaystackCheckoutAttemptStore(
        storage: storage,
        keyGenerator: () => 'checkout-key-1',
      );
      final prepared = await store.prepare(
        userId: 'user-1',
        amount: '5000',
        currency: 'NGN',
      );

      await store.recordServerState(
        userId: 'user-1',
        attemptKey: prepared.attemptKey,
        state: PaystackCheckoutAttemptState.pending,
        reference: 'fund-reference-1',
      );

      final restored = PaystackCheckoutAttemptStore(storage: storage);
      final attempt = await restored.findUnresolved('user-1');
      expect(attempt?.reference, 'fund-reference-1');
      expect(attempt?.state, PaystackCheckoutAttemptState.pending);
    });

    test('blocks a different amount while a checkout is unresolved', () async {
      final store = PaystackCheckoutAttemptStore(
        storage: MemoryPaystackCheckoutStorage(),
        keyGenerator: () => 'checkout-key-1',
      );
      await store.prepare(
        userId: 'user-1',
        amount: '5000',
        currency: 'NGN',
      );

      expect(
        () => store.prepare(
          userId: 'user-1',
          amount: '6000',
          currency: 'NGN',
        ),
        throwsA(isA<PaystackCheckoutConflictException>()),
      );
    });
  });

  group('PaystackCheckoutRecoveryService', () {
    test('retries transport loss with the same initialization key', () async {
      final storage = MemoryPaystackCheckoutStorage();
      final store = PaystackCheckoutAttemptStore(
        storage: storage,
        keyGenerator: () => 'checkout-key-1',
      );
      final initializationKeys = <String>[];
      var shouldLoseResponse = true;
      final service = PaystackCheckoutRecoveryService(
        store: store,
        initialize: ({required amount, required idempotencyKey}) async {
          initializationKeys.add(idempotencyKey);
          if (shouldLoseResponse) {
            shouldLoseResponse = false;
            throw StateError('transport lost');
          }
          return const PaystackCheckout(
            reference: 'fund-reference-1',
            authorizationUrl: null,
            status: 'PENDING',
            message: '',
          );
        },
        verify: (reference) async => const PaystackPaymentStatus(
          reference: 'fund-reference-1',
          status: 'PENDING',
        ),
      );

      expect(
        () => service.initializeCheckout(
          userId: 'user-1',
          amount: '5000',
          currency: 'NGN',
        ),
        throwsStateError,
      );

      final resumed = await service.initializeCheckout(
        userId: 'user-1',
        amount: '5000.00',
        currency: 'NGN',
      );

      expect(initializationKeys, ['checkout-key-1', 'checkout-key-1']);
      expect(resumed.attempt.reference, 'fund-reference-1');
      expect(resumed.attempt.state, PaystackCheckoutAttemptState.pending);
    });

    test('verifies a restored reference without reinitializing checkout',
        () async {
      final storage = MemoryPaystackCheckoutStorage();
      final store = PaystackCheckoutAttemptStore(
        storage: storage,
        keyGenerator: () => 'checkout-key-1',
      );
      final prepared = await store.prepare(
        userId: 'user-1',
        amount: '5000',
        currency: 'NGN',
      );
      await store.recordServerState(
        userId: 'user-1',
        attemptKey: prepared.attemptKey,
        state: PaystackCheckoutAttemptState.pending,
        reference: 'fund-reference-1',
      );

      final verifiedReferences = <String>[];
      final service = PaystackCheckoutRecoveryService(
        store: PaystackCheckoutAttemptStore(storage: storage),
        initialize: ({required amount, required idempotencyKey}) async {
          return Future<PaystackCheckout>.error(
            StateError(
                'A restored reference must not initialize a second checkout.'),
          );
        },
        verify: (reference) async {
          verifiedReferences.add(reference);
          return const PaystackPaymentStatus(
            reference: 'fund-reference-1',
            status: 'SUCCESS',
          );
        },
      );

      final restored = (await service.store.findUnresolved('user-1'))!;
      final result = await service.verifyCheckout(
        userId: 'user-1',
        attempt: restored,
      );

      expect(verifiedReferences, ['fund-reference-1']);
      expect(result.state, PaystackCheckoutAttemptState.success);
      expect(await service.store.findUnresolved('user-1'), isNull);
    });

    test('releases a rejected prepared attempt for a corrected amount',
        () async {
      final storage = MemoryPaystackCheckoutStorage();
      var keySequence = 0;
      final keys = <String>[];
      var rejectFirstAttempt = true;
      final service = PaystackCheckoutRecoveryService(
        store: PaystackCheckoutAttemptStore(
          storage: storage,
          keyGenerator: () => 'checkout-key-${++keySequence}',
        ),
        initialize: ({required amount, required idempotencyKey}) async {
          keys.add(idempotencyKey);
          if (rejectFirstAttempt) {
            rejectFirstAttempt = false;
            throw DioException(
              requestOptions: RequestOptions(path: '/api/payments/initialize'),
              response: Response<dynamic>(
                requestOptions:
                    RequestOptions(path: '/api/payments/initialize'),
                statusCode: 422,
              ),
            );
          }
          return const PaystackCheckout(
            reference: 'fund-reference-2',
            authorizationUrl: null,
            status: 'PENDING',
            message: '',
          );
        },
        verify: (reference) async => const PaystackPaymentStatus(
          reference: 'fund-reference-2',
          status: 'PENDING',
        ),
      );

      await expectLater(
        service.initializeCheckout(
          userId: 'user-1',
          amount: '5000',
          currency: 'NGN',
        ),
        throwsA(isA<DioException>()),
      );

      final corrected = await service.initializeCheckout(
        userId: 'user-1',
        amount: '6000',
        currency: 'NGN',
      );

      expect(keys, ['checkout-key-1', 'checkout-key-2']);
      expect(corrected.attempt.amount, '6000.00');
      expect(corrected.attempt.state, PaystackCheckoutAttemptState.pending);
    });
  });

  for (final hasLink in [true, false]) {
    testWidgets(
        'funding screen restores and verifies without reinitializing (link: $hasLink)',
        (tester) async {
      setMockSecureStorage(refreshToken: 'refresh-token');
      final copiedReferences = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copiedReferences.add((call.arguments as Map)['text'] as String);
          }
          return null;
        },
      );
      addTearDown(() => tester.binding.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));
      final storage = MemoryPaystackCheckoutStorage();
      final store = PaystackCheckoutAttemptStore(
        storage: storage,
        keyGenerator: () => 'checkout-key-1',
      );
      final prepared = await store.prepare(
        userId: 'user-1',
        amount: '5000',
        currency: 'NGN',
      );
      await store.recordServerState(
        userId: 'user-1',
        attemptKey: prepared.attemptKey,
        state: PaystackCheckoutAttemptState.pending,
        reference: 'fund-test-001',
        authorizationUrl: hasLink
            ? Uri.parse('https://checkout.paystack.com/fund-test-001')
            : null,
      );

      final bundle = buildTrustPayTestBundle();
      await tester.pumpWidget(
        MaterialApp(
          home: MoneyActionScreen(
            kind: MoneyActionKind.fund,
            apiClient: bundle.apiClient,
            paystackCheckoutAttemptStore: store,
            paymentRecoveryUserId: 'user-1',
          ),
        ),
      );
      await tester.pumpAndSettle(const Duration(milliseconds: 200));

      expect(find.text('Open checkout again'),
          hasLink ? findsOneWidget : findsNothing);
      expect(find.text('fund-test-001'), findsOneWidget);
      final copyReference = find.byWidgetPredicate((widget) =>
          widget is IconButton && widget.tooltip == 'Copy payment reference');
      expect(copyReference, findsOneWidget);
      await tester.ensureVisible(copyReference);
      await tester.pumpAndSettle();
      await tester.tap(copyReference);
      await tester.pump();
      expect(copiedReferences, ['fund-test-001']);
      if (!hasLink) {
        expect(find.textContaining('contact support'), findsOneWidget);
      }
      expect(find.text('Check payment status'), findsOneWidget);
      expect(
        bundle.adapter.requestedUris
            .where((uri) => uri.path == '/api/payments/initialize'),
        isEmpty,
      );
      expect(
        bundle.adapter.requestedUris
            .where((uri) => uri.path == '/api/payments/verify/fund-test-001'),
        hasLength(1),
      );
    });
  }
}
