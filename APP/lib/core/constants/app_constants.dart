import 'package:flutter/foundation.dart';

class AppConstants {
  AppConstants._();

  static const String appName = 'TrustPay';
  static const bool allowVtuWithoutKyc =
      bool.fromEnvironment('ALLOW_VTU_WITHOUT_KYC');
  static final String apiBaseUrl = _resolveApiBaseUrl();
  static final String websiteBaseUrl = _resolveWebsiteBaseUrl();
  static const Duration apiTimeout = Duration(seconds: 30);
  static const Duration quoteExpiry = Duration(minutes: 10);

  static Uri legalPageUri({String? fragment}) {
    final uri = Uri.parse('$websiteBaseUrl/legal');
    if (fragment == null || fragment.isEmpty) {
      return uri;
    }
    return uri.replace(fragment: fragment);
  }
}

const _productionApiBaseUrl = 'https://api.trustpayhq.com';
const _productionWebsiteBaseUrl = 'https://trustpay.xyz';
// Local development runs the API beside the Next.js admin panel. Keep these
// ports explicit so Flutter web does not send API requests to the frontend.
const _localApiPort = '3001';
const _localWebsitePort = '3000';
const _allowRemoteApiInDebug =
    bool.fromEnvironment('ALLOW_REMOTE_API_IN_DEBUG');

String _resolveApiBaseUrl() {
  const configured = String.fromEnvironment('API_BASE_URL');
  if (configured.isNotEmpty) {
    if (kReleaseMode && !configured.startsWith('https://')) {
      throw StateError('API_BASE_URL must use HTTPS in release builds.');
    }

    // Local web previews should not accidentally talk to production because
    // stale dart-defines were left in a run configuration.
    if (kIsWeb &&
        !kReleaseMode &&
        !_allowRemoteApiInDebug &&
        _isLocalHost(Uri.base.host) &&
        _isRemoteUrl(configured)) {
      return _localWebApiBaseUrl();
    }

    return configured;
  }

  if (kReleaseMode) {
    return _productionApiBaseUrl;
  }

  if (kIsWeb) {
    return _localWebApiBaseUrl();
  }

  switch (defaultTargetPlatform) {
    case TargetPlatform.android:
      return 'http://10.0.2.2:$_localApiPort';
    case TargetPlatform.iOS:
    case TargetPlatform.macOS:
    case TargetPlatform.linux:
    case TargetPlatform.windows:
    case TargetPlatform.fuchsia:
      return 'http://localhost:$_localApiPort';
  }
}

String _localWebApiBaseUrl() {
  return 'http://localhost:$_localApiPort';
}

bool _isLocalHost(String host) {
  return host == 'localhost' || host == '127.0.0.1' || host == '::1';
}

bool _isRemoteUrl(String value) {
  final uri = Uri.tryParse(value);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    return false;
  }

  return !_isLocalHost(uri.host);
}

String _resolveWebsiteBaseUrl() {
  const configured = String.fromEnvironment('WEBSITE_BASE_URL');
  if (configured.isNotEmpty) {
    if (kReleaseMode && !configured.startsWith('https://')) {
      throw StateError('WEBSITE_BASE_URL must use HTTPS in release builds.');
    }
    return configured;
  }

  if (kReleaseMode) {
    return _productionWebsiteBaseUrl;
  }

  if (kIsWeb) {
    return 'http://localhost:$_localWebsitePort';
  }

  switch (defaultTargetPlatform) {
    case TargetPlatform.android:
      return 'http://10.0.2.2:$_localWebsitePort';
    case TargetPlatform.iOS:
    case TargetPlatform.macOS:
    case TargetPlatform.linux:
    case TargetPlatform.windows:
    case TargetPlatform.fuchsia:
      return 'http://localhost:$_localWebsitePort';
  }
}
