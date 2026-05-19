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
      },
    );

    return _persistSession(response.data);
  }

  Future<bool> register({
    required String fullName,
    required String email,
    required String phone,
    required String password,
  }) async {
    final response = await _apiClient.client.post(
      '/api/auth/register',
      data: {
        'fullName': fullName.trim(),
        'email': email.trim(),
        'phone': _normalizePhone(phone),
        'password': password,
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

  Future<void> logout() async {
    try {
      await _apiClient.client.post('/api/auth/logout');
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
        data: {'refreshToken': refreshToken},
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

  String _normalizePhone(String phone) {
    return phone.replaceAll(RegExp(r'\s+'), '').trim();
  }
}

String authErrorMessage(Object error, String fallback) {
  if (error is DioException) {
    final data = error.response?.data;

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
