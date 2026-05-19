import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

class TransactionSecurityConfig {
  final bool hasPin;
  final int pinLength;
  final bool faceIdEnabled;
  final bool fingerprintEnabled;
  final bool canUseBiometrics;
  final bool hasFaceId;
  final bool hasFingerprint;

  const TransactionSecurityConfig({
    required this.hasPin,
    required this.pinLength,
    required this.faceIdEnabled,
    required this.fingerprintEnabled,
    required this.canUseBiometrics,
    required this.hasFaceId,
    required this.hasFingerprint,
  });

  bool get shouldOfferBiometrics =>
      canUseBiometrics && ((hasFaceId && faceIdEnabled) || (hasFingerprint && fingerprintEnabled));
}

class TransactionSecurityService {
  static const _storage = FlutterSecureStorage();
  static const _pinHashKey = 'trustpay_tx_pin_hash';
  static const _pinLengthKey = 'trustpay_tx_pin_length';
  static const _faceIdKey = 'trustpay_tx_face_id_enabled';
  static const _fingerprintKey = 'trustpay_tx_fingerprint_enabled';

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
        faceIdEnabled: false,
        fingerprintEnabled: false,
        canUseBiometrics: false,
        hasFaceId: false,
        hasFingerprint: false,
      );
    }

    bool canAuthenticate = false;
    bool hasFaceId = false;
    bool hasFingerprint = false;

    try {
      canAuthenticate =
          await _localAuth.canCheckBiometrics || await _localAuth.isDeviceSupported();
      final available = await _localAuth.getAvailableBiometrics();
      hasFaceId = available.contains(BiometricType.face) ||
          available.contains(BiometricType.strong);
      hasFingerprint = available.contains(BiometricType.fingerprint) ||
          available.contains(BiometricType.weak);
    } catch (_) {
      canAuthenticate = false;
    }

    return TransactionSecurityConfig(
      hasPin: pinHash != null && pinHash.isNotEmpty,
      pinLength: pinLength,
      faceIdEnabled: (await _storage.read(key: _faceIdKey)) == 'true',
      fingerprintEnabled: (await _storage.read(key: _fingerprintKey)) == 'true',
      canUseBiometrics: canAuthenticate,
      hasFaceId: hasFaceId,
      hasFingerprint: hasFingerprint,
    );
  }

  Future<void> savePin(String pin, {required int pinLength}) async {
    final digest = sha256.convert(utf8.encode(pin)).toString();
    await _storage.write(key: _pinHashKey, value: digest);
    await _storage.write(key: _pinLengthKey, value: '$pinLength');
  }

  Future<bool> verifyPin(String pin) async {
    final digest = sha256.convert(utf8.encode(pin)).toString();
    final saved = await _storage.read(key: _pinHashKey);
    return saved != null && saved == digest;
  }

  Future<void> setFaceIdEnabled(bool enabled) async {
    await _storage.write(key: _faceIdKey, value: '$enabled');
  }

  Future<void> setFingerprintEnabled(bool enabled) async {
    await _storage.write(key: _fingerprintKey, value: '$enabled');
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
}
