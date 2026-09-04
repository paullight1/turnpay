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
      clearTransactionApprovalCache: true,
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
      clearTransactionApprovalCache: true,
    );
  }

  Future<void> forgotPassword(String email) async {
    await _apiClient.client.post(
      '/api/auth/forgot-password',
      data: {'email': _normalizeEmail(email)},
    );
  }

  Future<void> verifyOtp({
    required String phone,
    required String otp,
  }) async {
    await _apiClient.client.post(
      '/api/auth/otp/verify',
      data: {
        'phone': _normalizePhone(phone),
        'otp': otp,
      },
    );
  }

  Future<void> resendOtp(String phone) async {
    await _apiClient.client.post(
      '/api/auth/otp/send',
      data: {'phone': _normalizePhone(phone)},
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
    bool clearTransactionApprovalCache = false,
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

    if (clearTransactionApprovalCache) {
      await _apiClient.clearTransactionApproval();
    }

    final refreshToken = session['refresh_token'];
    await _apiClient.saveSession(
      accessToken: accessToken,
      refreshToken: refreshToken is String ? refreshToken : null,
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
  final path = _extractRequestPath(error);

  if (error is DioException) {
    final data = error.response?.data;
    if (_isAuthRequest(path)) {
      return _authSafeMessage(
        fallback,
        path,
        statusCode: error.response?.statusCode,
      );
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

    return error.message ?? fallback;
  }

  return fallback;
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
    return 'Unable to sign in with those credentials';
  }

  if (path.contains('/refresh')) {
    return 'Your session has expired. Please sign in again.';
  }

  if (path.contains('/bootstrap')) {
    return 'Your session has expired. Please sign in again.';
  }

  if (path.contains('/register')) {
    if (statusCode == 409) {
      return 'Unable to complete registration. Try signing in or reset your password.';
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
