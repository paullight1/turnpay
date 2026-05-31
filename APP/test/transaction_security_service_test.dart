import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

void main() {
  group('TransactionPinGatePolicy', () {
    test('does not lock before the maximum failed attempts', () {
      final now = DateTime.utc(2026, 5, 20, 12);

      final state = TransactionPinGatePolicy.nextFailure(
        failedAttempts: 3,
        now: now,
      );

      expect(state.failedAttempts, 4);
      expect(state.lockedUntil, isNull);
    });

    test('locks with backoff once the maximum failed attempts is reached', () {
      final now = DateTime.utc(2026, 5, 20, 12);

      final state = TransactionPinGatePolicy.nextFailure(
        failedAttempts: 4,
        now: now,
      );

      expect(state.failedAttempts, 5);
      expect(state.lockedUntil, now.add(const Duration(minutes: 5)));
    });

    test('increases lockout duration after repeated failures', () {
      final now = DateTime.utc(2026, 5, 20, 12);

      final state = TransactionPinGatePolicy.nextFailure(
        failedAttempts: 7,
        now: now,
      );

      expect(state.failedAttempts, 8);
      expect(state.lockedUntil, now.add(const Duration(minutes: 20)));
    });
  });
}
