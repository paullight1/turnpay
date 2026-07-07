import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PIN key derivation', () {
    setUp(() => FlutterSecureStorage.setMockInitialValues({}));

    test('accepts the correct PIN and rejects an incorrect one', () async {
      final service = TransactionSecurityService();
      await service.savePin('2468', pinLength: 4);

      expect(await service.verifyPin('2468'), isTrue);
      expect(await service.verifyPin('1357'), isFalse);
    });

    test('stores a salted hash, not a raw or unsalted-SHA256 digest', () async {
      final service = TransactionSecurityService();
      await service.savePin('2468', pinLength: 4);

      const storage = FlutterSecureStorage();
      final hash = await storage.read(key: 'trustpay_tx_pin_hash');
      final salt = await storage.read(key: 'trustpay_tx_pin_salt');
      final unsalted = sha256.convert(utf8.encode('2468')).toString();

      expect(salt, isNotNull, reason: 'a per-install salt must be stored');
      expect(hash, isNotNull);
      expect(hash, isNot(equals('2468')), reason: 'never store the raw PIN');
      expect(
        hash,
        isNot(equals(unsalted)),
        reason: 'must be a salted KDF, not an unsalted SHA-256 digest',
      );
    });

    test('re-saving the same PIN produces a different salted hash', () async {
      final service = TransactionSecurityService();
      const storage = FlutterSecureStorage();

      await service.savePin('2468', pinLength: 4);
      final first = await storage.read(key: 'trustpay_tx_pin_hash');

      await service.savePin('2468', pinLength: 4);
      final second = await storage.read(key: 'trustpay_tx_pin_hash');

      expect(first, isNotNull);
      expect(second, isNot(equals(first)));
    });

    test('transparently migrates a legacy unsalted SHA-256 hash', () async {
      // Simulate a pre-migration install: unsalted hash, no salt.
      final legacy = sha256.convert(utf8.encode('2468')).toString();
      FlutterSecureStorage.setMockInitialValues({
        'trustpay_tx_pin_hash': legacy,
        'trustpay_tx_pin_length': '4',
      });

      final service = TransactionSecurityService();
      expect(await service.verifyPin('2468'), isTrue);

      const storage = FlutterSecureStorage();
      expect(
        await storage.read(key: 'trustpay_tx_pin_salt'),
        isNotNull,
        reason: 'a matched legacy hash should be upgraded to salted PBKDF2',
      );
      expect(
        await storage.read(key: 'trustpay_tx_pin_hash'),
        isNot(equals(legacy)),
      );
    });
  });

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
