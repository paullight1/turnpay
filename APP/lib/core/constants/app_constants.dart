import 'package:flutter/foundation.dart';

class AppConstants {
  AppConstants._();

  static const String appName = 'TrustPay';
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: kIsWeb ? 'http://127.0.0.1:3000' : 'http://localhost:3000',
  );
  static const Duration apiTimeout = Duration(seconds: 30);
  static const Duration quoteExpiry = Duration(minutes: 10);
}
