import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/payment_attempt_store.dart';
import 'package:trustpay_app/services/payment_recovery_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('PaymentAttemptStore', () {
    test('persists account-scoped keys and never stores credentials', () async {
      final storage = MemoryPaymentAttemptStorage();
      var sequence = 0;
      final store = PaymentAttemptStore(
        storage: storage,
        keyGenerator: () => 'attempt-${++sequence}',
        now: () => DateTime.utc(2026, 9, 5, 12),
      );

      final payload = {
        'amount': '25.50',
        'currency': 'NGN',
        'recipientEmail': 'Tolu@example.com',
        'transactionPin': '2468',
        'otp': '123456',
        'accessToken': 'bearer-value',
      };
      final key = await store.prepare(
        'user-1',
        PaymentAttemptOperation.internalTransfer,
        payload,
      );

      expect(key, 'attempt-1');
      final restored = PaymentAttemptStore(storage: storage);
      final attempts = await restored.loadUnresolved('user-1');
      expect(attempts, hasLength(1));
      expect(attempts.single.canonicalPayload['amount'], '25.50');
      expect(attempts.single.canonicalPayload['recipientEmail'],
          'Tolu@example.com');
      expect(attempts.single.canonicalPayload.containsKey('transactionPin'),
          isFalse);
      expect(attempts.single.canonicalPayload.containsKey('otp'), isFalse);
      expect(
          attempts.single.canonicalPayload.containsKey('accessToken'), isFalse);

      final raw = storage.values.values.single;
      expect(raw, isNot(contains('2468')));
      expect(raw, isNot(contains('123456')));
      expect(raw, isNot(contains('bearer-value')));
      expect(await restored.loadUnresolved('another-user'), isEmpty);

      final replayedKey = await restored.prepare(
        'user-1',
        PaymentAttemptOperation.internalTransfer,
        payload,
      );
      expect(replayedKey, key);

      await restored.recordServerState(
        userId: 'user-1',
        attemptKey: key,
        state: PaymentAttemptState.success,
        reference: 'IT-001',
      );
      expect(await restored.loadUnresolved('user-1'), isEmpty);
      expect((await restored.loadAll('user-1')).single.reference, 'IT-001');
    });

    test('serializes concurrent writes and gives changed payload a new key',
        () async {
      final storage = MemoryPaymentAttemptStorage();
      final firstStore = PaymentAttemptStore(
        storage: storage,
        keyGenerator: () => 'attempt-1',
      );
      final secondStore = PaymentAttemptStore(
        storage: storage,
        keyGenerator: () => 'attempt-2',
      );

      final firstPayload = {'amount': '10.00', 'currency': 'NGN'};
      final samePayload = {'currency': 'NGN', 'amount': '10.00'};
      final keys = await Future.wait([
        firstStore.prepare(
          'user-1',
          PaymentAttemptOperation.vtuPurchase,
          firstPayload,
        ),
        secondStore.prepare(
          'user-1',
          PaymentAttemptOperation.vtuPurchase,
          samePayload,
        ),
      ]);

      expect(keys[0], keys[1]);
      expect(await secondStore.loadUnresolved('user-1'), hasLength(1));

      final changed = await secondStore.prepare(
        'user-1',
        PaymentAttemptOperation.vtuPurchase,
        {'amount': '11.00', 'currency': 'NGN'},
      );
      expect(changed, isNot(keys.first));
      expect(await firstStore.loadUnresolved('user-1'), hasLength(2));
    });

    test('corrupted storage fails closed instead of allowing a payment',
        () async {
      final storage = MemoryPaymentAttemptStorage();
      final store = PaymentAttemptStore(storage: storage);
      storage.values[store.storageKeyForUser('user-1')] = '{broken';

      expect(
        () => store.prepare(
          'user-1',
          PaymentAttemptOperation.withdrawal,
          {'amount': '100.00', 'currency': 'NGN'},
        ),
        throwsA(isA<PaymentAttemptStoreException>()),
      );
    });
  });

  group('PaymentRecoveryService', () {
    test('uses resolver operation names and a fresh key per status check',
        () async {
      final storage = MemoryPaymentAttemptStorage();
      final store = PaymentAttemptStore(
        storage: storage,
        keyGenerator: () => 'payment-key',
      );
      final paymentKey = await store.prepare(
        'user-1',
        PaymentAttemptOperation.vtuPurchase,
        {
          'type': 'airtime',
          'amount': '100.00',
          'currency': 'NGN',
        },
      );
      await store.markSubmitted('user-1', paymentKey);

      final adapter = _ResolverAdapter([
        {'state': 'PENDING', 'reference': 'VTU-001'},
        {'state': 'SUCCESS', 'reference': 'VTU-001'},
      ]);
      final apiClient = _apiClientFor(adapter);
      var requestKey = 0;
      final service = PaymentRecoveryService(
        apiClient: apiClient,
        store: store,
        requestKeyGenerator: () => 'resolver-${++requestKey}',
      );

      var attempt = (await store.loadUnresolved('user-1')).single;
      attempt = await service.resolveAttempt(
        userId: 'user-1',
        attempt: attempt,
      );
      expect(attempt.state, PaymentAttemptState.pending);
      expect(attempt.reference, 'VTU-001');

      attempt = await service.resolveAttempt(
        userId: 'user-1',
        attempt: attempt,
      );
      expect(attempt.state, PaymentAttemptState.success);
      expect(adapter.requestKeys, ['resolver-1', 'resolver-2']);
      expect(adapter.requestKeys, isNot(contains(paymentKey)));
      expect(adapter.operations, ['VTU_PURCHASE', 'VTU_PURCHASE']);
      expect(adapter.attemptKeys, [paymentKey, paymentKey]);
      expect(await store.loadUnresolved('user-1'), isEmpty);
    });

    test('a resolver 404 preserves an unresolved outcome as UNKNOWN', () async {
      final storage = MemoryPaymentAttemptStorage();
      final store = PaymentAttemptStore(
        storage: storage,
        keyGenerator: () => 'withdrawal-key',
      );
      final key = await store.prepare(
        'user-1',
        PaymentAttemptOperation.withdrawal,
        {'amount': '100.00', 'currency': 'NGN', 'beneficiaryId': 'b-1'},
      );
      await store.markSubmitted('user-1', key);

      final adapter = _ResolverAdapter(const [], statusCode: 404);
      final service = PaymentRecoveryService(
        apiClient: _apiClientFor(adapter),
        store: store,
        requestKeyGenerator: () => 'resolver-404',
      );
      final attempt = (await store.loadUnresolved('user-1')).single;
      final resolved = await service.resolveAttempt(
        userId: 'user-1',
        attempt: attempt,
      );

      expect(resolved.state, PaymentAttemptState.unknown);
      expect(await store.loadUnresolved('user-1'), hasLength(1));
    });

    test(
        'does not release the journal on a terminal response without a reference',
        () async {
      final storage = MemoryPaymentAttemptStorage();
      final store = PaymentAttemptStore(
        storage: storage,
        keyGenerator: () => 'internal-key',
      );
      final key = await store.prepare(
        'user-1',
        PaymentAttemptOperation.internalTransfer,
        {'amount': '10.00', 'currency': 'NGN', 'recipientEmail': 'a@b.test'},
      );
      await store.markSubmitted('user-1', key);

      final service = PaymentRecoveryService(
        apiClient: _apiClientFor(_ResolverAdapter([
          {'state': 'SUCCESS'},
        ])),
        store: store,
        requestKeyGenerator: () => 'resolver-no-reference',
      );
      final resolved = await service.resolveAttempt(
        userId: 'user-1',
        attempt: (await store.loadUnresolved('user-1')).single,
      );

      expect(resolved.state, PaymentAttemptState.unknown);
      expect(await store.loadUnresolved('user-1'), hasLength(1));
    });

    test('rejects resolver lookups across account scopes', () async {
      final storage = MemoryPaymentAttemptStorage();
      final store = PaymentAttemptStore(
        storage: storage,
        keyGenerator: () => 'account-key',
      );
      final key = await store.prepare(
        'user-1',
        PaymentAttemptOperation.withdrawal,
        {'amount': '5.00', 'currency': 'NGN'},
      );
      final attempt = (await store.loadUnresolved('user-1')).single;
      final service = PaymentRecoveryService(
        apiClient: _apiClientFor(_ResolverAdapter([
          {'state': 'SUCCESS', 'reference': 'W-001'},
        ])),
        store: store,
      );

      expect(
        () => service.resolveAttempt(userId: 'user-2', attempt: attempt),
        throwsA(isA<PaymentRecoveryException>()),
      );
      expect(key, 'account-key');
    });

    test('extracts only the JWT subject for account scoping', () {
      String encode(Object value) =>
          base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
      final token =
          '${encode({'alg': 'none'})}.${encode({'sub': 'user-7'})}.sig';

      expect(PaymentRecoveryService.userIdFromAccessToken(token), 'user-7');
      expect(
          PaymentRecoveryService.userIdFromAccessToken('not-a-token'), isNull);
    });
  });
}

ApiClient _apiClientFor(_ResolverAdapter adapter) {
  final dio = Dio(
    BaseOptions(
      baseUrl: 'https://resolver.test',
      headers: const {'Content-Type': 'application/json'},
    ),
  )..httpClientAdapter = adapter;
  return ApiClient(dio: dio);
}

class _ResolverAdapter implements HttpClientAdapter {
  _ResolverAdapter(this.responses, {this.statusCode = 200});

  final List<Map<String, dynamic>> responses;
  final int statusCode;
  final List<String> requestKeys = [];
  final List<String> operations = [];
  final List<String> attemptKeys = [];
  var _responseIndex = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requestKeys.add(
      '${options.headers['Idempotency-Key'] ?? options.headers['idempotency-key']}',
    );
    final body = Map<String, dynamic>.from(options.data as Map);
    operations.add('${body['operation']}');
    attemptKeys.add('${body['attemptKey']}');
    final response = responses.isEmpty
        ? {'message': 'not found'}
        : responses[_responseIndex++ % responses.length];
    return ResponseBody.fromString(
      jsonEncode(response),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
