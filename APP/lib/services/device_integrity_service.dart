import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

enum DeviceIntegritySignal { clear, risky, unavailable }

/// Local signals reduce accidental use on compromised devices. They are not
/// server-verified attestation and cannot prove that a device is uncompromised.
class DeviceIntegrityService {
  const DeviceIntegrityService(
      {this.enforced = kReleaseMode,
      this.channel = const MethodChannel('trustpay/device_integrity')});
  final bool enforced;
  final MethodChannel channel;

  Future<DeviceIntegritySignal> check() async {
    try {
      switch (await channel.invokeMethod<String>('check')) {
        case 'clear':
          return DeviceIntegritySignal.clear;
        case 'risky':
          return DeviceIntegritySignal.risky;
        default:
          return DeviceIntegritySignal.unavailable;
      }
    } catch (_) {
      return DeviceIntegritySignal.unavailable;
    }
  }

  static bool isSensitiveMutation(String method, String path) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].contains(method.toUpperCase())) {
      return false;
    }
    return path == '/api/transfers/internal' ||
        path == '/api/vtu/purchase' ||
        path == '/api/payments/withdraw' ||
        path.startsWith('/api/payments/withdrawals/') ||
        path == '/api/exchange/manual-orders' ||
        path == '/api/exchange/execute' ||
        path == '/api/exchange/payouts';
  }

  Future<void> requireForRequest(String method, String path) async {
    if (!(kReleaseMode || enforced) ||
        kIsWeb ||
        !isSensitiveMutation(method, path)) {
      return;
    }
    if (await check() != DeviceIntegritySignal.clear) {
      throw StateError(
          'This device cannot currently approve payments. Check your device security and try again, or contact support.');
    }
  }
}
