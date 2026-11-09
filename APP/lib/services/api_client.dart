import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../core/auth/auth_state.dart';
import '../core/constants/app_constants.dart';
import 'transaction_security_service.dart';
import 'device_integrity_service.dart';
import 'secure_transport_factory.dart';

class ApiClient {
  static const _accessTokenKey = 'trustpay_access_token';
  static const _refreshTokenKey = 'trustpay_refresh_token';
  static const _accountEmailKey = 'trustpay_account_email';
  static const _storage = FlutterSecureStorage();
  static const _uuid = Uuid();
  static final _transactionSecurity = TransactionSecurityService();
  static Future<String?>? _refreshInFlight;

  late final Dio _dio;

  ApiClient({Dio? dio})
      : _dio = dio ??
            createApiDio(
              BaseOptions(
                baseUrl: AppConstants.apiBaseUrl,
                connectTimeout: AppConstants.apiTimeout,
                receiveTimeout: AppConstants.apiTimeout,
                headers: {'Content-Type': 'application/json'},
              ),
            ) {
    _dio.interceptors.add(SafeDioLogInterceptor(enabled: kDebugMode));

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          try {
            await const DeviceIntegrityService()
                .requireForRequest(options.method, options.uri.path);
          } catch (error) {
            return handler.reject(DioException(
                requestOptions: options,
                error: error,
                message:
                    'Device security could not be verified. Contact support if this continues.'));
          }
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
            // The session is only cleared when the refresh endpoint explicitly
            // rejected it (401/403) — see _performRefresh. On a network/timeout
            // failure we keep the tokens so an offline blip doesn't sign the
            // user out; the next request will retry the refresh.
            return handler.next(error);
          }

          try {
            final retryOptions = error.requestOptions;
            retryOptions.headers['Authorization'] = 'Bearer $accessToken';
            final data = retryOptions.data;
            if (data is FormData) retryOptions.data = data.clone();
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

  Future<String?> readAccountEmail() {
    return _storage.read(key: _accountEmailKey);
  }

  Future<void> saveSession({
    required String accessToken,
    String? refreshToken,
    String? email,
  }) async {
    final subject = _jwtSubject(accessToken);
    if (subject == null) {
      await _transactionSecurity.clearAllDevicePinState();
    } else {
      await _transactionSecurity.bindToAuthenticatedUser(subject);
    }
    await _storage.write(key: _accessTokenKey, value: accessToken);

    if (refreshToken != null && refreshToken.isNotEmpty) {
      await _storage.write(key: _refreshTokenKey, value: refreshToken);
    }
    if (email != null && email.trim().isNotEmpty) {
      await _storage.write(
        key: _accountEmailKey,
        value: email.trim().toLowerCase(),
      );
    }
  }

  Future<void> clearSession() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _accountEmailKey);
    await _transactionSecurity.clearAllDevicePinState();
  }

  Future<void> clearLegacyTransactionApprovalMaterial() {
    return _transactionSecurity.clearLegacyTransactionApprovalMaterial();
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
      // Nothing to refresh with — the session is effectively gone.
      await _handleAuthRejected();
      return null;
    }

    final refreshClient = createApiDio(
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
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
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
    } on DioException catch (error) {
      // Only a server-side rejection (401/403) means the refresh token is no
      // longer valid. Network/timeout failures must NOT clear the session.
      if (isAuthRejection(error)) {
        await _handleAuthRejected();
      }
      return null;
    }
  }

  /// Clears the stored session and signals the router that the session has
  /// expired so it can redirect to the login screen.
  Future<void> _handleAuthRejected() async {
    await clearSession();
    authStateNotifier.markExpired();
  }

  /// True when a refresh failed because the server explicitly rejected it.
  static bool isAuthRejection(DioException error) {
    final status = error.response?.statusCode;
    return status == 401 || status == 403;
  }

  static String? _jwtSubject(String token) {
    final segments = token.split('.');
    if (segments.length != 3) return null;
    try {
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(segments[1]))),
      );
      if (payload is! Map<String, dynamic>) return null;
      final subject = payload['sub'];
      return subject is String && subject.trim().isNotEmpty
          ? subject.trim()
          : null;
    } catch (_) {
      return null;
    }
  }
}

typedef IdempotencyKeyGenerator = String Function();

class MoneyAttemptIdempotency {
  MoneyAttemptIdempotency({IdempotencyKeyGenerator? keyGenerator})
      : _keyGenerator = keyGenerator ?? ApiClient._uuid.v4;

  final IdempotencyKeyGenerator _keyGenerator;
  String? _attemptFingerprint;
  String? _attemptKey;

  String keyFor(String fingerprint) {
    if (_attemptFingerprint == fingerprint && _attemptKey != null) {
      return _attemptKey!;
    }

    _attemptFingerprint = fingerprint;
    _attemptKey = _keyGenerator();
    return _attemptKey!;
  }

  void markFinalOutcome() {
    _attemptFingerprint = null;
    _attemptKey = null;
  }
}

class SafeDioLogInterceptor extends Interceptor {
  SafeDioLogInterceptor({required this.enabled});

  final bool enabled;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (enabled) {
      final snapshot = ApiLogRedactor.redactRequest(options);
      debugPrint(
        'API request ${options.method} ${options.uri.path} '
        'headers=${snapshot.headers} body=${snapshot.body}',
      );
    }
    handler.next(options);
  }

  @override
  void onResponse(
    Response<dynamic> response,
    ResponseInterceptorHandler handler,
  ) {
    if (enabled) {
      final snapshot = ApiLogRedactor.redactResponse(response);
      debugPrint(
        'API response ${response.statusCode} '
        '${response.requestOptions.uri.path} body=${snapshot.body}',
      );
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (enabled) {
      final snapshot = ApiLogRedactor.redactRequest(err.requestOptions);
      final responseSnapshot = err.response == null
          ? null
          : ApiLogRedactor.redactResponse(err.response!);
      debugPrint(
        'API error ${err.response?.statusCode ?? 'network'} '
        '${err.requestOptions.uri.path} headers=${snapshot.headers} '
        'requestBody=${snapshot.body} responseBody=${responseSnapshot?.body}',
      );
    }
    handler.next(err);
  }
}

class ApiLogSnapshot {
  const ApiLogSnapshot({required this.headers, required this.body});

  final Map<String, dynamic> headers;
  final dynamic body;
}

class ApiLogRedactor {
  static const redacted = '<redacted>';
  static const omittedRequestBody = '<omitted:request-body>';
  static const omittedResponseBody = '<omitted:response-body>';

  static final List<RegExp> _sensitiveKeyPatterns = [
    RegExp('authorization', caseSensitive: false),
    RegExp('cookie', caseSensitive: false),
    RegExp('password', caseSensitive: false),
    RegExp('token', caseSensitive: false),
    RegExp('secret', caseSensitive: false),
    RegExp('api[-_]?key', caseSensitive: false),
    RegExp('idempotency[-_]?key', caseSensitive: false),
    RegExp('pin', caseSensitive: false),
    RegExp('otp', caseSensitive: false),
    RegExp('account(number)?', caseSensitive: false),
    RegExp('card', caseSensitive: false),
  ];

  static ApiLogSnapshot redactRequest(RequestOptions options) {
    return ApiLogSnapshot(
      headers: _redactMap(options.headers),
      body: options.data == null ? null : omittedRequestBody,
    );
  }

  static ApiLogSnapshot redactResponse(Response<dynamic> response) {
    return ApiLogSnapshot(
      headers: _redactMap(response.headers.map),
      body: response.data == null ? null : omittedResponseBody,
    );
  }

  static Map<String, dynamic> _redactMap(Map<dynamic, dynamic> input) {
    return input.map((key, value) {
      final keyText = '$key';
      return MapEntry(
        keyText,
        _isSensitiveKey(keyText) ? redacted : _redactValue(value),
      );
    });
  }

  static dynamic _redactValue(dynamic value) {
    if (value is Map) return _redactMap(value);
    if (value is List) return value.map(_redactValue).toList();
    return value;
  }

  static bool _isSensitiveKey(String key) {
    return _sensitiveKeyPatterns.any((pattern) => pattern.hasMatch(key));
  }
}
