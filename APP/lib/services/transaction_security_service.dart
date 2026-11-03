import 'dart:convert';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';
import 'app_pin_kdf.dart';

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

  bool get hasAppLock => hasPin || biometricEnabled;

  bool get shouldOfferBiometrics => canUseBiometrics && biometricEnabled;
}

/// Device-local app unlock only. Server transaction PINs are never saved here.
/// Legacy storage keys are retained so existing app locks continue to work.
class TransactionSecurityService {
  static final ValueNotifier<int> changes = ValueNotifier<int>(0);
  static const _storage = FlutterSecureStorage();
  static const _pinHashKey = 'trustpay_tx_pin_hash';
  static const _pinSaltKey = 'trustpay_tx_pin_salt';
  static const _pinValueKey = 'trustpay_tx_pin_value';
  static const _pinLengthKey = 'trustpay_tx_pin_length';
  static const _biometricKey = 'trustpay_tx_biometric_enabled';
  static const _biometricPromptSeenKey = 'trustpay_tx_biometric_prompt_seen';
  static const _faceIdKey = 'trustpay_tx_face_id_enabled';
  static const _fingerprintKey = 'trustpay_tx_fingerprint_enabled';
  static const _pinFailedAttemptsKey = 'trustpay_tx_pin_failed_attempts';
  static const _pinLockedUntilKey = 'trustpay_tx_pin_locked_until';
  static const _activeUserKey = 'trustpay_tx_pin_active_user';

  // Order device credential writes with logout/account changes. In particular,
  // a KDF completing in an isolate must not resurrect a cleared credential.
  static Future<void>? _deviceOperations;
  Future<T> _serialize<T>(Future<T> Function() operation) {
    final pending = _deviceOperations;
    final next =
        pending == null ? operation() : pending.then((_) => operation());
    final tail =
        next.then<void>((_) {}, onError: (Object error, StackTrace stack) {});
    _deviceOperations = tail;
    tail.then((_) {
      if (identical(_deviceOperations, tail)) _deviceOperations = null;
    });
    return next;
  }

  final LocalAuthentication _localAuth = LocalAuthentication();

  Future<TransactionSecurityConfig> getConfig() async {
    await _purgeLegacyStoredPinValue();
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
        biometricLabel: 'Phone security',
      );
    }

    bool canAuthenticate = false;
    bool hasBiometric = false;
    String biometricLabel = 'Biometric app unlock';

    try {
      canAuthenticate = await _localAuth.canCheckBiometrics ||
          await _localAuth.isDeviceSupported();
      final available = await _localAuth
          .getAvailableBiometrics()
          .catchError((_) => <BiometricType>[]);
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

  Future<void> savePin(String pin, {required int pinLength}) =>
      _serialize(() => _saveAppPin(pin, pinLength: pinLength));

  Future<void> _saveAppPin(String pin, {required int pinLength}) async {
    if (!RegExp(r'^\d{4,6}$').hasMatch(pin) || pin.length != pinLength) {
      throw ArgumentError('App-unlock PIN must contain 4 to 6 digits');
    }
    await _purgeLegacyStoredPinValue();
    final salt = _generateSalt();
    final saltB64 = base64.encode(salt);
    final digest = await deriveAppPinHash(pin, salt);

    await _storage.write(key: _pinSaltKey, value: saltB64);
    await _storage.write(key: _pinHashKey, value: digest);
    await _storage.write(key: _pinLengthKey, value: '$pinLength');
    await _clearPinFailures();
    changes.value++;
  }

  Future<void> saveVerifiedDevicePin(String pin) {
    return savePin(pin, pinLength: pin.length);
  }

  Future<void> bindToAuthenticatedUser(String userId) =>
      _serialize(() => _bindUser(userId));

  Future<void> _bindUser(String userId) async {
    final normalized = userId.trim();
    if (normalized.isEmpty) {
      await _clearAllDevicePinState();
      return;
    }

    final current = await _storage.read(key: _activeUserKey);
    if (current != null && current != normalized) {
      await _clearPersistedPinState();
    }
    await _storage.write(key: _activeUserKey, value: normalized);
    if (current != normalized) changes.value++;
  }

  Future<void> clearAllDevicePinState() => _serialize(_clearAllDevicePinState);

  Future<void> _clearAllDevicePinState() async {
    await _clearPersistedPinState();
    await _storage.delete(key: _activeUserKey);
    changes.value++;
  }

  Future<bool> verifyPin(String pin) async {
    final result = await verifyPinWithLockout(pin);
    return result.approved;
  }

  Future<PinVerificationResult> verifyPinWithLockout(String pin) =>
      _serialize(() => _verifyAppPin(pin));

  Future<PinVerificationResult> _verifyAppPin(String pin) async {
    await _purgeLegacyStoredPinValue();
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

  Future<void> setBiometricEnabled(bool enabled) =>
      _serialize(() => _setDeviceAuthentication(enabled));

  Future<void> _setDeviceAuthentication(bool enabled) async {
    await _storage.write(key: _biometricKey, value: '$enabled');
    await markBiometricPromptSeen();
    await _storage.delete(key: _faceIdKey);
    await _storage.delete(key: _fingerprintKey);
    changes.value++;
  }

  /// Returns whether the one-time biometric setup prompt has already been
  /// shown on this device. This is intentionally device-local state; it never
  /// leaves secure storage or becomes part of an API request.
  Future<bool> hasSeenBiometricPrompt() async {
    return await _storage.read(key: _biometricPromptSeenKey) == 'true';
  }

  Future<void> markBiometricPromptSeen() async {
    await _storage.write(key: _biometricPromptSeenKey, value: 'true');
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
        biometricOnly: false,
        persistAcrossBackgrounding: true,
      );
    } catch (_) {
      return false;
    }
  }

  /// Removes the legacy raw-PIN key used by older app versions.
  ///
  /// Biometric app unlock never yields or replays a transaction PIN. Money
  /// actions must collect a fresh PIN and send it through the normal server
  /// verification path until an OS-bound server challenge is implemented.
  Future<void> clearLegacyTransactionApprovalMaterial() async {
    await _purgeLegacyStoredPinValue();
  }

  Future<void> _clearPersistedPinState() async {
    for (final key in [
      _pinHashKey,
      _pinSaltKey,
      _pinValueKey,
      _pinLengthKey,
      _biometricKey,
      _biometricPromptSeenKey,
      _faceIdKey,
      _fingerprintKey,
      _pinFailedAttemptsKey,
      _pinLockedUntilKey,
    ]) {
      await _storage.delete(key: key);
    }
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
      final digest = await deriveAppPinHash(pin, salt);
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
    await _storage.write(
      key: _pinHashKey,
      value: await deriveAppPinHash(pin, salt),
    );
    return true;
  }

  Future<void> _purgeLegacyStoredPinValue() {
    return _storage.delete(key: _pinValueKey);
  }

  // ─── KEY DERIVATION ──────────────────────────────────────────────────────
  // PBKDF2-HMAC-SHA256 implemented on top of package:crypto so no extra
  // dependency is required. Salt is random per install (regenerated whenever a
  // PIN is (re)saved) and stored alongside the derived hash.
  static const _saltLength = 16;

  static List<int> _generateSalt() {
    final random = math.Random.secure();
    return List<int>.generate(_saltLength, (_) => random.nextInt(256));
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
    if (available.contains(BiometricType.face)) {
      return defaultTargetPlatform == TargetPlatform.iOS
          ? 'Face ID'
          : 'Face recognition';
    }
    if (available.contains(BiometricType.fingerprint)) {
      return defaultTargetPlatform == TargetPlatform.iOS
          ? 'Touch ID'
          : 'Fingerprint';
    }
    return 'Phone security';
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

enum TransactionPinServerEntryMode { create, verifyExisting }

enum TransactionPinResetStep {
  verifyCurrent,
  enterReplacement,
  confirmReplacement,
}

class TransactionPinResetPolicy {
  static TransactionPinResetStep step({
    required String? currentPin,
    required String? replacementPin,
  }) {
    if (currentPin == null) {
      return TransactionPinResetStep.verifyCurrent;
    }
    if (replacementPin == null) {
      return TransactionPinResetStep.enterReplacement;
    }
    return TransactionPinResetStep.confirmReplacement;
  }

  static String? validateReplacement({
    required String currentPin,
    required String replacementPin,
  }) {
    if (currentPin == replacementPin) {
      return 'Choose a PIN different from your current PIN.';
    }
    return null;
  }

  static String? validateConfirmation({
    required String replacementPin,
    required String confirmationPin,
  }) {
    if (replacementPin != confirmationPin) {
      return 'PINs did not match. Enter the new PIN again.';
    }
    return null;
  }
}

class TransactionPinServerPolicy {
  static TransactionPinServerEntryMode entryMode({
    required bool serverConfigured,
  }) {
    return serverConfigured
        ? TransactionPinServerEntryMode.verifyExisting
        : TransactionPinServerEntryMode.create;
  }

  static bool mayPersistCreatedPin({
    required bool setupSucceeded,
    required bool serverConfiguredAfterConflict,
  }) {
    return setupSucceeded && !serverConfiguredAfterConflict;
  }
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
