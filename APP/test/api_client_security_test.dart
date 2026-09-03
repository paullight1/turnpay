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
    test('redacts sensitive headers and omits request payloads', () {
      final request = RequestOptions(
        path: '/api/users/profile',
        headers: {
          'Authorization': 'Bearer token-value',
          'X-Request-ID': 'req-123',
        },
        data: {
          'password': 'secret',
          'transactionPin': '1234',
          'nested': {'accountNumber': '0123456789', 'safe': 'visible'},
        },
      );

      final snapshot = ApiLogRedactor.redactRequest(request);

      expect(snapshot.headers['Authorization'], '<redacted>');
      expect(snapshot.headers['X-Request-ID'], 'req-123');
      expect(snapshot.body, '<omitted:request-body>');
    });

    test('omits bodies entirely for sensitive endpoints', () {
      final request = RequestOptions(
        path: '/api/payments/withdraw',
        data: {'amount': '1000.00', 'accountNumber': '0123456789'},
      );

      final snapshot = ApiLogRedactor.redactRequest(request);

      expect(snapshot.body, '<omitted:request-body>');
    });

    test('redacts PIN verification and both idempotency header spellings', () {
      final request = RequestOptions(
        path: '/api/auth/transaction-pin/verify',
        headers: {
          'Idempotency-Key': 'raw-attempt-key',
          'X-Idempotency-Key': 'raw-legacy-attempt-key',
        },
        data: {'pin': '2468', 'otp': '112233'},
      );

      final snapshot = ApiLogRedactor.redactRequest(request);

      expect(snapshot.headers, {
        'Idempotency-Key': '<redacted>',
        'X-Idempotency-Key': '<redacted>',
      });
      expect(snapshot.body, '<omitted:request-body>');
      final serialized = '${snapshot.headers}${snapshot.body}';
      expect(serialized, isNot(contains('raw-attempt-key')));
      expect(serialized, isNot(contains('2468')));
    });

    test(
      'PIN status response exposes configuration but no credential value',
      () {
        final response = Response<dynamic>(
          requestOptions: RequestOptions(
            path: '/api/auth/transaction-pin/status',
          ),
          data: {
            'configured': true,
            'pinLength': 4,
            'locked': false,
            'resetHoldUntil': null,
          },
        );

        final snapshot = ApiLogRedactor.redactResponse(response);

        expect(snapshot.body, '<omitted:response-body>');
      },
    );
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
    test(
      'clears cached biometric transaction approval on session clear',
      () async {
        final securityService = _FakeTransactionSecurityService(
          approveBiometric: true,
        );
        await securityService.savePin('2468', pinLength: 4);

        final client = ApiClient();
        await client.clearSession();

        expect(
          await securityService.unlockPinWithBiometric(
            reason: 'Approve transaction',
          ),
          isNull,
        );
      },
    );
  });
}

class _FakeTransactionSecurityService extends TransactionSecurityService {
  _FakeTransactionSecurityService({required this.approveBiometric});

  final bool approveBiometric;

  @override
  Future<bool> authenticateBiometric({required String reason}) async {
    return approveBiometric;
  }
}
