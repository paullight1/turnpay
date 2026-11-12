import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../core/auth/auth_state.dart';
import 'api_client.dart';

class AuthService {
  AuthService({ApiClient? apiClient}) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  Future<bool> login({
    required String email,
    required String password,
  }) async {
    final response = await _apiClient.client.post(
      '/api/auth/login',
      data: {
        'email': _normalizeEmail(email),
        'password': password,
        'deviceName': _deviceName(),
      },
    );

    return _persistSession(
      response.data,
      email: _normalizeEmail(email),
      clearLegacyTransactionApprovalMaterial: true,
    );
  }

  Future<bool> register({
    required String fullName,
    required String email,
    required String phone,
    required String password,
    required String transactionPin,
    String? referralCode,
  }) async {
    final response = await _apiClient.client.post(
      '/api/auth/register',
      data: {
        'fullName': fullName.trim(),
        'email': _normalizeEmail(email),
        'phone': _normalizePhone(phone),
        'password': password,
        'transactionPin': transactionPin,
        'deviceName': _deviceName(),
        if (referralCode != null && referralCode.trim().isNotEmpty)
          'referralCode': referralCode.trim().toUpperCase(),
      },
    );

    return _persistSession(
      response.data,
      email: _normalizeEmail(email),
      clearLegacyTransactionApprovalMaterial: true,
    );
  }

  Future<void> forgotPassword(String email) async {
    await _apiClient.client.post(
      '/api/auth/forgot-password',
      data: {'email': _normalizeEmail(email)},
    );
  }

  Future<void> verifyOtp({
    required String email,
    required String otp,
  }) async {
    await _apiClient.client.post(
      '/api/auth/otp/verify',
      data: {
        'email': _normalizeEmail(email),
        'otp': otp,
      },
    );
  }

  Future<void> resendOtp(String email) async {
    await _apiClient.client.post(
      '/api/auth/otp/send',
      data: {'email': _normalizeEmail(email)},
    );
  }

  Future<void> setTransactionPin(String pin) async {
    await _apiClient.client.post(
      '/api/auth/transaction-pin',
      data: {'pin': pin},
    );
  }

  Future<TransactionPinServerStatus> getTransactionPinStatus() async {
    final response = await _apiClient.client.get(
      '/api/auth/transaction-pin/status',
    );
    final data = response.data;
    if (data is! Map<String, dynamic>) {
      throw StateError('Invalid transaction PIN status response');
    }

    final rawLength = data['pinLength'];
    final pinLength =
        rawLength is int && rawLength >= 4 && rawLength <= 6 ? rawLength : null;
    return TransactionPinServerStatus(
      configured: data['configured'] == true,
      pinLength: pinLength,
      resetHoldUntil: data['resetHoldUntil'] is String
          ? DateTime.tryParse(data['resetHoldUntil'] as String)?.toUtc()
          : null,
      locked: data['locked'] == true,
    );
  }

  Future<void> verifyTransactionPin(String pin) async {
    await _apiClient.client.post(
      '/api/auth/transaction-pin/verify',
      data: {'pin': pin},
    );
  }

  Future<void> resetTransactionPin({
    required String currentPin,
    required String newPin,
  }) async {
    await _apiClient.client.patch(
      '/api/auth/transaction-pin',
      data: {'currentPin': currentPin, 'newPin': newPin},
    );
  }

  Future<void> logout() async {
    final refreshToken = await _apiClient.readRefreshToken();

    try {
      await _apiClient.client.post(
        '/api/auth/logout',
        data: refreshToken == null || refreshToken.isEmpty
            ? null
            : {'refreshToken': refreshToken},
      );
    } on DioException {
      // Local token cleanup should still happen if the API session is gone.
    } finally {
      await _apiClient.clearSession();
      // This is a deliberate sign-out, not an expiry — clear any stale signal.
      authStateNotifier.reset();
    }
  }

  Future<void> bootstrap() async {
    await _apiClient.client.post('/api/auth/bootstrap');
  }

  /// Attempts to restore a stored session.
  ///
  /// Tokens are ONLY cleared when the server explicitly rejects the refresh
  /// (HTTP 401/403). A network/transport failure (timeout, airplane mode, no
  /// response) keeps the session and returns [SessionRestoreState.offline] so
  /// the caller can retry later instead of logging the user out.
  Future<SessionRestoreState> restoreSession() async {
    final refreshToken = await _apiClient.readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      // Nothing to restore — treat as expired without touching storage.
      return SessionRestoreState.expired;
    }

    try {
      final response = await _apiClient.client.post(
        '/api/auth/refresh',
        data: {
          'refreshToken': refreshToken,
          'deviceName': _deviceName(),
        },
      );

      final persisted = await _persistSession(response.data);
      return persisted
          ? SessionRestoreState.active
          : SessionRestoreState.expired;
    } on DioException catch (error) {
      if (ApiClient.isAuthRejection(error)) {
        await _apiClient.clearSession();
        authStateNotifier.markExpired();
        return SessionRestoreState.expired;
      }

      // Offline / transient transport error — keep the tokens and retry later.
      return SessionRestoreState.offline;
    }
  }

  /// Backwards-compatible boolean wrapper around [restoreSession]. Returns
  /// true only when the session is confirmed active by the server.
  Future<bool> refreshSession() async {
    return await restoreSession() == SessionRestoreState.active;
  }

  Future<bool> _persistSession(
    dynamic payload, {
    String? email,
    bool clearLegacyTransactionApprovalMaterial = false,
  }) async {
    if (payload is! Map<String, dynamic>) {
      return false;
    }

    final session = payload['session'];
    if (session is! Map<String, dynamic>) {
      return false;
    }

    final accessToken = session['access_token'];
    if (accessToken is! String || accessToken.isEmpty) {
      return false;
    }

    if (clearLegacyTransactionApprovalMaterial) {
      await _apiClient.clearLegacyTransactionApprovalMaterial();
    }

    final refreshToken = session['refresh_token'];
    await _apiClient.saveSession(
      accessToken: accessToken,
      refreshToken: refreshToken is String ? refreshToken : null,
      email: email,
    );

    // A valid session clears any lingering "session expired" signal.
    authStateNotifier.reset();

    return true;
  }

  Future<List<Map<String, dynamic>>> listSessions() async {
    final response = await _apiClient.client.get('/api/auth/sessions');
    final payload = response.data;

    if (payload is! Map<String, dynamic>) {
      return [];
    }

    final sessions = payload['sessions'];
    if (sessions is! List) {
      return [];
    }

    return sessions.whereType<Map<String, dynamic>>().toList(growable: false);
  }

  Future<bool> revokeSession(String sessionId) async {
    await _apiClient.client.delete('/api/auth/sessions/$sessionId');
    return true;
  }

  String _normalizePhone(String phone) {
    return phone.replaceAll(RegExp(r'\s+'), '').trim();
  }

  String _normalizeEmail(String email) {
    return email.trim().toLowerCase();
  }

  String _deviceName() {
    if (kIsWeb) {
      return 'TrustPay Flutter Web';
    }

    final platform = switch (defaultTargetPlatform) {
      TargetPlatform.android => 'Android',
      TargetPlatform.iOS => 'iOS',
      TargetPlatform.macOS => 'macOS',
      TargetPlatform.linux => 'Linux',
      TargetPlatform.windows => 'Windows',
      TargetPlatform.fuchsia => 'Fuchsia',
    };

    return 'TrustPay Flutter $platform';
  }
}

class TransactionPinServerStatus {
  final bool configured;
  final int? pinLength;
  final DateTime? resetHoldUntil;
  final bool locked;

  const TransactionPinServerStatus({
    required this.configured,
    required this.pinLength,
    required this.resetHoldUntil,
    required this.locked,
  });
}

String authErrorMessage(Object error, String fallback) {
  final pinMessage = transactionPinRejectionMessage(error);
  if (pinMessage != null) return pinMessage;
  final path = _extractRequestPath(error);

  if (error is DioException) {
    final data = error.response?.data;
    if (path == '/api/kyc/verify' &&
        (error.response == null || (error.response?.statusCode ?? 0) >= 500)) {
      return 'We could not confirm your verification result. Check verification status before retrying. Your entered details have been kept.';
    }
    if (_isAuthRequest(path)) {
      if (error.response == null) {
        return error.type == DioExceptionType.cancel
            ? fallback
            : 'Could not connect to TrustPay. Check your connection and try again.';
      }
      if ((error.response?.statusCode ?? 0) >= 500) {
        return 'TrustPay is temporarily unavailable. Please try again shortly.';
      }
      if (path?.contains('/register') == true &&
          error.response?.statusCode == 409) {
        final conflictMessage = _registrationConflictMessage(data);
        if (conflictMessage != null) return conflictMessage;
      }
      return _authSafeMessage(
        fallback,
        path,
        statusCode: error.response?.statusCode,
      );
    }

    final isRead = const ['GET', 'HEAD']
        .contains(error.requestOptions.method.toUpperCase());
    if (error.response == null) {
      // Mutations can have committed even when their response was lost. Keep
      // the caller's original-payment/status recovery instructions intact.
      if (!isRead || error.type == DioExceptionType.cancel) return fallback;
      return switch (error.type) {
        DioExceptionType.connectionTimeout ||
        DioExceptionType.sendTimeout ||
        DioExceptionType.receiveTimeout =>
          'TrustPay is taking longer than expected. Please try again shortly.',
        DioExceptionType.badCertificate =>
          'A secure connection to TrustPay could not be established. Please try again later.',
        _ =>
          'We could not reach TrustPay. Check your connection and try again.',
      };
    }
    final status = error.response?.statusCode ?? 0;
    if (status >= 500) {
      return isRead
          ? 'TrustPay is temporarily unavailable. Please try again shortly.'
          : fallback;
    }
    if (status == 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (status == 429) {
      return 'Too many requests. Please wait a moment and try again.';
    }

    if (data is Map<String, dynamic>) {
      final message = data['message'];
      if (message is String && message.isNotEmpty) return message;
      if (message is List && message.isNotEmpty) {
        return message.whereType<String>().join('\n');
      }
      if (message is Map<String, dynamic>) {
        final nestedMessage = message['message'];
        if (nestedMessage is String && nestedMessage.isNotEmpty) {
          return nestedMessage;
        }
        if (nestedMessage is List && nestedMessage.isNotEmpty) {
          return nestedMessage.whereType<String>().join('\n');
        }
      }
    }

    return fallback;
  }

  return fallback;
}

/// Only authenticated, explicit PIN rejections get PIN-specific retry copy.
/// A transport/server failure remains an uncertain payment outcome.
String? transactionPinRejectionMessage(Object error) {
  if (error is! DioException || error.response?.statusCode != 403) return null;
  dynamic value = error.response?.data;
  for (var depth = 0; depth < 4 && value is Map; depth++) {
    value = value['message'];
  }
  return switch (value) {
    'Invalid transaction PIN' => 'Incorrect transaction PIN. Try again.',
    'Transaction PIN is temporarily locked' =>
      'Your transaction PIN is temporarily locked. Try again later.',
    'Transaction PIN changed; please try again' =>
      'Your transaction PIN changed. Enter your current transaction PIN.',
    'Transaction PIN was recently reset; money movement is temporarily locked' =>
      'Payments are temporarily paused after your transaction PIN change. Check Security & Limits for the end time.',
    'Transaction PIN setup is required' =>
      'Create your transaction PIN in Security & Limits before paying.',
    _ => null,
  };
}

String? _registrationConflictMessage(Object? data) {
  if (data is! Map<String, dynamic>) return null;
  final message = data['message'];
  if (message is! Map<String, dynamic>) return null;

  return switch (message['code']) {
    'EMAIL_ALREADY_REGISTERED' =>
      'That email is already linked to a TrustPay account. Sign in with that email or reset your password.',
    'PHONE_ALREADY_REGISTERED' =>
      'That phone number is already linked to a TrustPay account. Use a different phone number or sign in with the linked email.',
    _ => null,
  };
}

bool isRegistrationConflict(Object error) {
  return error is DioException &&
      error.response?.statusCode == 409 &&
      _extractRequestPath(error)?.contains('/register') == true;
}

bool _isAuthRequest(String? path) {
  return path != null && path.startsWith('/api/auth/');
}

String _authSafeMessage(
  String fallback,
  String? path, {
  int? statusCode,
}) {
  if (path == null) {
    return fallback;
  }

  if (statusCode == 429) {
    if (path.contains('/register')) {
      return 'Registration is temporarily rate limited. Please try again later.';
    }

    return 'Too many attempts. Please wait a moment and try again.';
  }

  if (path.contains('/login')) {
    return 'Unable to sign in. Check your email and password, or choose Verify email if you have not confirmed it yet.';
  }

  if (path.contains('/refresh') && statusCode == 401) {
    return 'Your session has expired. Please sign in again.';
  }

  if (path.contains('/bootstrap') && statusCode == 401) {
    return 'Your session has expired. Please sign in again.';
  }

  if (path.contains('/register')) {
    if (statusCode == 409) {
      return 'An account already uses that email or phone number. Sign in with the email already linked to your account.';
    }

    return 'Unable to complete registration.';
  }

  if (path.contains('/sessions')) {
    return 'Session action failed. Please try again.';
  }

  if (path.contains('/forgot-password') || path.contains('/otp')) {
    return 'Please try again.';
  }

  return fallback;
}

String? _extractRequestPath(Object error) {
  if (error is DioException) {
    final options = error.requestOptions;
    return options.path;
  }

  return null;
}
