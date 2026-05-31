import 'package:flutter/foundation.dart';

class AppConstants {
  AppConstants._();

  static const String appName = 'TrustPay';
  static final String apiBaseUrl = _resolveApiBaseUrl();
  static const Duration apiTimeout = Duration(seconds: 30);
  static const Duration quoteExpiry = Duration(minutes: 10);
}

String _resolveApiBaseUrl() {
  const configured = String.fromEnvironment('API_BASE_URL');
  if (configured.isNotEmpty) {
    if (kReleaseMode && !configured.startsWith('https://')) {
      throw StateError('API_BASE_URL must use HTTPS in release builds.');
    }
    return configured;
  }

  if (kReleaseMode) {
    throw StateError('API_BASE_URL is required in release builds.');
  }

  return kIsWeb ? 'http://127.0.0.1:4000' : 'http://localhost:4000';
}
