import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../core/constants/app_constants.dart';

class ApiClient {
  static const _accessTokenKey = 'trustpay_access_token';
  static const _refreshTokenKey = 'trustpay_refresh_token';
  static const _storage = FlutterSecureStorage();
  static const _uuid = Uuid();

  late final Dio _dio;
  Future<String?>? _refreshInFlight;

  ApiClient() {
    _dio = Dio(
      BaseOptions(
        baseUrl: AppConstants.apiBaseUrl,
        connectTimeout: AppConstants.apiTimeout,
        receiveTimeout: AppConstants.apiTimeout,
        headers: {'Content-Type': 'application/json'},
      ),
    );

    _dio.interceptors.add(
      LogInterceptor(
        request: kDebugMode,
        requestHeader: kDebugMode,
        requestBody: kDebugMode,
        responseHeader: kDebugMode,
        responseBody: kDebugMode,
        error: kDebugMode,
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final accessToken = await _storage.read(key: _accessTokenKey);

          if (accessToken != null && accessToken.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $accessToken';
          }

          final method = options.method.toUpperCase();
          if (['POST', 'PUT', 'PATCH', 'DELETE'].contains(method) &&
              !options.headers.containsKey('Idempotency-Key')) {
            options.headers['Idempotency-Key'] = _uuid.v4();
          }

          return handler.next(options);
        },
        onError: (error, handler) async {
          if (!_shouldRefresh(error)) {
            return handler.next(error);
          }

          final accessToken = await _refreshAccessToken();
          if (accessToken == null) {
            await clearSession();
            return handler.next(error);
          }

          try {
            final retryOptions = error.requestOptions;
            retryOptions.headers['Authorization'] = 'Bearer $accessToken';
            final response = await _dio.fetch<dynamic>(retryOptions);
            return handler.resolve(response);
          } on DioException catch (retryError) {
            return handler.next(retryError);
          }
        },
      ),
    );
  }

  Dio get client => _dio;

  Future<String?> readRefreshToken() {
    return _storage.read(key: _refreshTokenKey);
  }

  Future<void> saveSession({
    required String accessToken,
    String? refreshToken,
  }) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);

    if (refreshToken != null && refreshToken.isNotEmpty) {
      await _storage.write(key: _refreshTokenKey, value: refreshToken);
    }
  }

  Future<void> clearSession() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
  }

  bool _shouldRefresh(DioException error) {
    if (error.response?.statusCode != 401) return false;
    if (error.requestOptions.extra['retriedAfterRefresh'] == true) {
      return false;
    }
    if (error.requestOptions.path.contains('/api/auth/refresh')) {
      return false;
    }
    error.requestOptions.extra['retriedAfterRefresh'] = true;
    return true;
  }

  Future<String?> _refreshAccessToken() {
    _refreshInFlight ??= _performRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
    return _refreshInFlight!;
  }

  Future<String?> _performRefresh() async {
    final refreshToken = await readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      return null;
    }

    final refreshClient = Dio(
      BaseOptions(
        baseUrl: AppConstants.apiBaseUrl,
        connectTimeout: AppConstants.apiTimeout,
        receiveTimeout: AppConstants.apiTimeout,
        headers: {'Content-Type': 'application/json'},
      ),
    );

    try {
      final response = await refreshClient.post<dynamic>(
        '/api/auth/refresh',
        data: {'refreshToken': refreshToken},
      );

      final data = response.data;
      if (data is! Map<String, dynamic>) return null;
      final session = data['session'];
      if (session is! Map<String, dynamic>) return null;
      final accessToken = session['access_token'];
      if (accessToken is! String || accessToken.isEmpty) return null;

      final nextRefreshToken = session['refresh_token'];
      await saveSession(
        accessToken: accessToken,
        refreshToken: nextRefreshToken is String ? nextRefreshToken : null,
      );

      return accessToken;
    } on DioException {
      return null;
    }
  }
}
