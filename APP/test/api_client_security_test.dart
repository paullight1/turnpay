import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/api_client.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    TransactionSecurityService.debugResetEphemeralState();
  });

  tearDown(TransactionSecurityService.debugResetEphemeralState);

  group('ApiLogRedactor', () {
    test('redacts sensitive headers and nested body fields', () {
      final request = RequestOptions(
        path: '/api/users/profile',
        headers: {
          'Authorization': 'Bearer token-value',
          'X-Request-ID': 'req-123',
        },
        data: {
          'password': 'secret',
          'transactionPin': '1234',
          'nested': {
            'accountNumber': '0123456789',
            'safe': 'visible',
          },
        },
      );

      final snapshot = ApiLogRedactor.redactRequest(request);

      expect(snapshot.headers['Authorization'], '<redacted>');
      expect(snapshot.headers['X-Request-ID'], 'req-123');
      expect(snapshot.body, {
        'password': '<redacted>',
        'transactionPin': '<redacted>',
        'nested': {
          'accountNumber': '<redacted>',
          'safe': 'visible',
        },
      });
    });

    test('omits bodies entirely for sensitive endpoints', () {
      final request = RequestOptions(
        path: '/api/payments/withdraw',
        data: {
          'amount': '1000.00',
          'accountNumber': '0123456789',
        },
      );

      final snapshot = ApiLogRedactor.redactRequest(request);

      expect(snapshot.body, '<omitted:sensitive-endpoint>');
    });
  });

  group('MoneyAttemptIdempotency', () {
    test('reuses key for the same visible attempt until final outcome', () {
      var sequence = 0;
      final attempts = MoneyAttemptIdempotency(
        keyGenerator: () => 'key-${++sequence}',
      );

      final first = attempts.keyFor('send:NGN:1000.00:user@example.com');
      final retry = attempts.keyFor('send:NGN:1000.00:user@example.com');

      expect(retry, first);

      attempts.markFinalOutcome();
      final next = attempts.keyFor('send:NGN:1000.00:user@example.com');

      expect(next, isNot(first));
    });

    test('starts a new key when the visible attempt fields change', () {
      var sequence = 0;
      final attempts = MoneyAttemptIdempotency(
        keyGenerator: () => 'key-${++sequence}',
      );

      final first = attempts.keyFor('send:NGN:1000.00:user@example.com');
      final changed = attempts.keyFor('send:NGN:2000.00:user@example.com');

      expect(changed, isNot(first));
    });
  });

  group('session cleanup', () {
    test('clears cached biometric transaction approval on session clear',
        () async {
      final securityService =
          _FakeTransactionSecurityService(approveBiometric: true);
      await securityService.savePin('2468', pinLength: 4);

      final client = ApiClient();
      await client.clearSession();

      expect(
        await securityService.unlockPinWithBiometric(
          reason: 'Approve transaction',
        ),
        isNull,
      );
    });
  });
}

class _FakeTransactionSecurityService extends TransactionSecurityService {
  _FakeTransactionSecurityService({
    required this.approveBiometric,
  });

  final bool approveBiometric;

  @override
  Future<bool> authenticateBiometric({
    required String reason,
  }) async {
    return approveBiometric;
  }
}
