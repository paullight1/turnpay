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
    final digest = sha256.convert(utf8.encode(pin)).toString();
    await _storage.write(key: _pinHashKey, value: digest);
    await _storage.write(key: _pinValueKey, value: pin);
    await _storage.write(key: _pinLengthKey, value: '$pinLength');
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

    final digest = sha256.convert(utf8.encode(pin)).toString();
    final saved = await _storage.read(key: _pinHashKey);
    final approved = saved != null && saved == digest;
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
