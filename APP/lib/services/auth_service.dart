import 'dart:io';

import 'package:dio/dio.dart';

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
        'email': email.trim(),
        'password': password,
        'deviceName': _deviceName(),
      },
    );

    return _persistSession(response.data);
  }

  Future<bool> register({
    required String fullName,
    required String email,
    required String phone,
    required String password,
    required String transactionPin,
  }) async {
    final response = await _apiClient.client.post(
      '/api/auth/register',
      data: {
        'fullName': fullName.trim(),
        'email': email.trim(),
        'phone': _normalizePhone(phone),
        'password': password,
        'transactionPin': transactionPin,
        'deviceName': _deviceName(),
      },
    );

    return _persistSession(response.data);
  }

  Future<void> forgotPassword(String email) async {
    await _apiClient.client.post(
      '/api/auth/forgot-password',
      data: {'email': email.trim()},
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
    }
  }

  Future<void> bootstrap() async {
    await _apiClient.client.post('/api/auth/bootstrap');
  }

  Future<bool> refreshSession() async {
    final refreshToken = await _apiClient.readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      await _apiClient.clearSession();
      return false;
    }

    try {
      final response = await _apiClient.client.post(
        '/api/auth/refresh',
        data: {
          'refreshToken': refreshToken,
          'deviceName': _deviceName(),
        },
      );

      return _persistSession(response.data);
    } on DioException {
      await _apiClient.clearSession();
      return false;
    }
  }

  Future<bool> _persistSession(dynamic payload) async {
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

    final refreshToken = session['refresh_token'];
    await _apiClient.saveSession(
      accessToken: accessToken,
      refreshToken: refreshToken is String ? refreshToken : null,
    );

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

    return sessions
        .whereType<Map<String, dynamic>>()
        .toList(growable: false);
  }

  Future<bool> revokeSession(String sessionId) async {
    await _apiClient.client.delete('/api/auth/sessions/$sessionId');
    return true;
  }

  String _normalizePhone(String phone) {
    return phone.replaceAll(RegExp(r'\s+'), '').trim();
  }

  String _deviceName() {
    final platform = Platform.operatingSystem;
    final version = Platform.operatingSystemVersion;

    if (platform.isNotEmpty) {
      if (version.isNotEmpty) {
        final versionLabel =
            '$platform ${version.replaceAll(RegExp(r'\s+'), ' ')}'.trim();
        return versionLabel.length > 120
            ? versionLabel.substring(0, 120)
            : versionLabel;
      }

      return platform;
    }

    return 'Unknown mobile device';
  }
}

String authErrorMessage(Object error, String fallback) {
  final path = _extractRequestPath(error);

  if (error is DioException) {
    final data = error.response?.data;
    if (_isAuthRequest(path)) {
      return _authSafeMessage(fallback, path);
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

String _authSafeMessage(String fallback, String? path) {
  if (path == null) {
    return fallback;
  }

  if (path.contains('/login')) {
    return 'Unable to sign in with those credentials';
  }

  if (path.contains('/refresh')) {
    return 'Your session has expired. Please sign in again.';
  }

  if (path.contains('/register')) {
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
