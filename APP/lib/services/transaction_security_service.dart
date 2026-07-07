import 'dart:convert';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

class TransactionSecurityConfig {
  final bool hasPin;
  final int pinLength;
  final bool biometricEnabled;
  final bool canUseBiometrics;
  final bool hasBiometric;
  final String biometricLabel;

  const TransactionSecurityConfig({
    required this.hasPin,
    required this.pinLength,
    required this.biometricEnabled,
    required this.canUseBiometrics,
    required this.hasBiometric,
    required this.biometricLabel,
  });

  bool get shouldOfferBiometrics =>
      canUseBiometrics && hasBiometric && biometricEnabled;
}

class TransactionSecurityService {
  static const _storage = FlutterSecureStorage();
  static const _pinHashKey = 'trustpay_tx_pin_hash';
  static const _pinSaltKey = 'trustpay_tx_pin_salt';

  // Raw PIN entry. Only written when biometric approval is available, because
  // the server-side money-action APIs require the plaintext PIN to be re-sent
  // for each transaction (see money_action_screen) and biometric approval must
  // be able to supply it. The read is always gated behind a successful
  // biometric prompt (see [unlockPinWithBiometric]).
  //
  // TODO(launch): bind this entry to a hardware keystore key that requires user
  // authentication (Android setUserAuthenticationRequired / iOS
  // biometryCurrentSet) via a platform channel or an updated secure-storage
  // plugin, so the OS — not just our code path — enforces biometric access.
  static const _pinValueKey = 'trustpay_tx_pin_value';
  static const _pinLengthKey = 'trustpay_tx_pin_length';
  static const _biometricKey = 'trustpay_tx_biometric_enabled';
  static const _faceIdKey = 'trustpay_tx_face_id_enabled';
  static const _fingerprintKey = 'trustpay_tx_fingerprint_enabled';
  static const _pinFailedAttemptsKey = 'trustpay_tx_pin_failed_attempts';
  static const _pinLockedUntilKey = 'trustpay_tx_pin_locked_until';

  final LocalAuthentication _localAuth = LocalAuthentication();

  Future<TransactionSecurityConfig> getConfig() async {
    final pinHash = await _storage.read(key: _pinHashKey);
    final pinLength = int.tryParse(
          await _storage.read(key: _pinLengthKey) ?? '',
        ) ??
        4;

    if (kIsWeb) {
      return TransactionSecurityConfig(
        hasPin: pinHash != null && pinHash.isNotEmpty,
        pinLength: pinLength,
        biometricEnabled: false,
        canUseBiometrics: false,
        hasBiometric: false,
        biometricLabel: 'Biometric approval',
      );
    }

    bool canAuthenticate = false;
    bool hasBiometric = false;
    String biometricLabel = 'Biometric approval';

    try {
      canAuthenticate = await _localAuth.canCheckBiometrics ||
          await _localAuth.isDeviceSupported();
      final available = await _localAuth.getAvailableBiometrics();
      hasBiometric = canAuthenticate && available.isNotEmpty;
      biometricLabel = _biometricLabel(available);
    } catch (_) {
      canAuthenticate = false;
    }

    final biometricEnabled =
        (await _storage.read(key: _biometricKey)) == 'true' ||
            (await _storage.read(key: _faceIdKey)) == 'true' ||
            (await _storage.read(key: _fingerprintKey)) == 'true';

    return TransactionSecurityConfig(
      hasPin: pinHash != null && pinHash.isNotEmpty,
      pinLength: pinLength,
      biometricEnabled: biometricEnabled,
      canUseBiometrics: canAuthenticate,
      hasBiometric: hasBiometric,
      biometricLabel: biometricLabel,
    );
  }

  Future<void> savePin(String pin, {required int pinLength}) async {
    final salt = _generateSalt();
    final saltB64 = base64.encode(salt);
    final digest = _derivePinHash(pin, salt);

    await _storage.write(key: _pinSaltKey, value: saltB64);
    await _storage.write(key: _pinHashKey, value: digest);
    await _storage.write(key: _pinLengthKey, value: '$pinLength');
    // Retain the raw PIN only so biometric approval can re-supply it to the
    // server-side money-action APIs (see [_pinValueKey] docs / TODO(launch)).
    await _storage.write(key: _pinValueKey, value: pin);
    await _clearPinFailures();
  }

  Future<bool> verifyPin(String pin) async {
    final result = await verifyPinWithLockout(pin);
    return result.approved;
  }

  Future<PinVerificationResult> verifyPinWithLockout(String pin) async {
    final now = DateTime.now().toUtc();
    final lockedUntil = await _readLockedUntil();
    if (lockedUntil != null && lockedUntil.isAfter(now)) {
      return PinVerificationResult.locked(lockedUntil);
    }

    final approved = await _matchesStoredPin(pin);
    if (approved) {
      await _clearPinFailures();
      return const PinVerificationResult.approved();
    }

    final failedAttempts = int.tryParse(
          await _storage.read(key: _pinFailedAttemptsKey) ?? '',
        ) ??
        0;
    final nextState = TransactionPinGatePolicy.nextFailure(
      failedAttempts: failedAttempts,
      now: now,
    );
    await _storage.write(
      key: _pinFailedAttemptsKey,
      value: '${nextState.failedAttempts}',
    );
    if (nextState.lockedUntil == null) {
      await _storage.delete(key: _pinLockedUntilKey);
    } else {
      await _storage.write(
        key: _pinLockedUntilKey,
        value: nextState.lockedUntil!.toIso8601String(),
      );
    }

    return PinVerificationResult.rejected(
      failedAttempts: nextState.failedAttempts,
      lockedUntil: nextState.lockedUntil,
    );
  }

  Future<void> setBiometricEnabled(bool enabled) async {
    await _storage.write(key: _biometricKey, value: '$enabled');
    await _storage.delete(key: _faceIdKey);
    await _storage.delete(key: _fingerprintKey);
  }

  Future<bool> authenticateBiometric({
    required String reason,
  }) async {
    if (kIsWeb) {
      return false;
    }

    try {
      return await _localAuth.authenticate(
        localizedReason: reason,
        biometricOnly: true,
        persistAcrossBackgrounding: true,
      );
    } catch (_) {
      return false;
    }
  }

  /// Reveals the stored PIN after a successful biometric prompt so it can be
  /// re-sent to the server for money-action authorization.
  ///
  /// This is intentionally the ONLY path that reads the raw PIN back, and it is
  /// always gated behind [authenticateBiometric]. App-unlock does not use this;
  /// it relies on [authenticateBiometric] directly and never needs plaintext.
  Future<String?> unlockPinWithBiometric({
    required String reason,
  }) async {
    final approved = await authenticateBiometric(reason: reason);
    if (!approved) {
      return null;
    }

    final pin = await _storage.read(key: _pinValueKey);
    if (pin == null || !RegExp(r'^\d{4,6}$').hasMatch(pin)) {
      return null;
    }

    return pin;
  }

  Future<DateTime?> _readLockedUntil() async {
    final raw = await _storage.read(key: _pinLockedUntilKey);
    if (raw == null || raw.isEmpty) return null;
    return DateTime.tryParse(raw)?.toUtc();
  }

  Future<void> _clearPinFailures() async {
    await _storage.delete(key: _pinFailedAttemptsKey);
    await _storage.delete(key: _pinLockedUntilKey);
  }

  /// Compares [pin] against the stored salted PBKDF2 hash. Transparently
  /// migrates any legacy unsalted SHA-256 hash to the salted scheme on a match.
  Future<bool> _matchesStoredPin(String pin) async {
    final saved = await _storage.read(key: _pinHashKey);
    if (saved == null || saved.isEmpty) return false;

    final saltB64 = await _storage.read(key: _pinSaltKey);
    if (saltB64 != null && saltB64.isNotEmpty) {
      final salt = base64.decode(saltB64);
      final digest = _derivePinHash(pin, salt);
      return _constantTimeEquals(digest, saved);
    }

    // Legacy fallback: pre-migration installs stored an unsalted SHA-256 hash
    // and no salt. Accept a match once, then upgrade it in place to salted
    // PBKDF2 so the plaintext-derivable digest is never used again.
    final legacy = sha256.convert(utf8.encode(pin)).toString();
    if (!_constantTimeEquals(legacy, saved)) {
      return false;
    }

    final salt = _generateSalt();
    await _storage.write(key: _pinSaltKey, value: base64.encode(salt));
    await _storage.write(key: _pinHashKey, value: _derivePinHash(pin, salt));
    return true;
  }

  // ─── KEY DERIVATION ──────────────────────────────────────────────────────
  // PBKDF2-HMAC-SHA256 implemented on top of package:crypto so no extra
  // dependency is required. Salt is random per install (regenerated whenever a
  // PIN is (re)saved) and stored alongside the derived hash.
  static const _pbkdf2Iterations = 120000;
  static const _saltLength = 16;
  static const _keyLength = 32;

  static List<int> _generateSalt() {
    final random = math.Random.secure();
    return List<int>.generate(_saltLength, (_) => random.nextInt(256));
  }

  static String _derivePinHash(String pin, List<int> salt) {
    final bytes = _pbkdf2(
      password: utf8.encode(pin),
      salt: salt,
      iterations: _pbkdf2Iterations,
      keyLength: _keyLength,
    );
    return base64.encode(bytes);
  }

  static List<int> _pbkdf2({
    required List<int> password,
    required List<int> salt,
    required int iterations,
    required int keyLength,
  }) {
    final hmac = Hmac(sha256, password);
    final blockCount = (keyLength / 32).ceil();
    final derived = <int>[];

    for (var block = 1; block <= blockCount; block++) {
      final blockIndex = [
        (block >> 24) & 0xff,
        (block >> 16) & 0xff,
        (block >> 8) & 0xff,
        block & 0xff,
      ];
      var u = hmac.convert([...salt, ...blockIndex]).bytes;
      final t = List<int>.from(u);
      for (var i = 1; i < iterations; i++) {
        u = hmac.convert(u).bytes;
        for (var j = 0; j < t.length; j++) {
          t[j] ^= u[j];
        }
      }
      derived.addAll(t);
    }

    return derived.sublist(0, keyLength);
  }

  static bool _constantTimeEquals(String a, String b) {
    if (a.length != b.length) return false;
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return result == 0;
  }

  String _biometricLabel(List<BiometricType> available) {
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return 'Face ID';
    }
    if (available.contains(BiometricType.face)) {
      return 'Face ID';
    }
    if (available.contains(BiometricType.fingerprint)) {
      return 'Fingerprint';
    }
    return 'Biometric approval';
  }
}

class PinVerificationResult {
  final bool approved;
  final bool lockedOut;
  final int failedAttempts;
  final DateTime? lockedUntil;

  const PinVerificationResult._({
    required this.approved,
    required this.lockedOut,
    required this.failedAttempts,
    required this.lockedUntil,
  });

  const PinVerificationResult.approved()
      : this._(
          approved: true,
          lockedOut: false,
          failedAttempts: 0,
          lockedUntil: null,
        );

  const PinVerificationResult.rejected({
    required int failedAttempts,
    DateTime? lockedUntil,
  }) : this._(
          approved: false,
          lockedOut: lockedUntil != null,
          failedAttempts: failedAttempts,
          lockedUntil: lockedUntil,
        );

  const PinVerificationResult.locked(DateTime lockedUntil)
      : this._(
          approved: false,
          lockedOut: true,
          failedAttempts: TransactionPinGatePolicy.maxFailedAttempts,
          lockedUntil: lockedUntil,
        );
}

class TransactionPinFailureState {
  final int failedAttempts;
  final DateTime? lockedUntil;

  const TransactionPinFailureState({
    required this.failedAttempts,
    required this.lockedUntil,
  });
}

class TransactionPinGatePolicy {
  static const maxFailedAttempts = 5;
  static const baseLockout = Duration(minutes: 5);
  static const maxLockout = Duration(minutes: 30);

  static TransactionPinFailureState nextFailure({
    required int failedAttempts,
    required DateTime now,
  }) {
    final nextFailedAttempts = failedAttempts + 1;
    if (nextFailedAttempts < maxFailedAttempts) {
      return TransactionPinFailureState(
        failedAttempts: nextFailedAttempts,
        lockedUntil: null,
      );
    }

    final exponent = math.max(0, nextFailedAttempts - maxFailedAttempts - 1);
    final minutes = math.min(
      maxLockout.inMinutes,
      baseLockout.inMinutes * (1 << exponent),
    );
    return TransactionPinFailureState(
      failedAttempts: nextFailedAttempts,
      lockedUntil: now.add(Duration(minutes: minutes)),
    );
  }
}
