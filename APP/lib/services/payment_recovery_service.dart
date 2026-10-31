import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import 'api_client.dart';
import 'payment_attempt_store.dart';

class PaymentRecoveryService {
  PaymentRecoveryService({
    required ApiClient apiClient,
    required PaymentAttemptStore store,
    FlutterSecureStorage? secureStorage,
    String Function()? requestKeyGenerator,
  })  : _apiClient = apiClient,
        _store = store,
        _secureStorage = secureStorage ?? const FlutterSecureStorage(),
        _requestKeyGenerator = requestKeyGenerator ?? _uuid.v4;

  static const accessTokenKey = 'trustpay_access_token';
  static const Uuid _uuid = Uuid();

  final ApiClient _apiClient;
  final PaymentAttemptStore _store;
  final FlutterSecureStorage _secureStorage;
  final String Function() _requestKeyGenerator;

  PaymentAttemptStore get store => _store;

  /// Reads only the non-sensitive JWT subject to select the secure journal
  /// namespace. The token itself is never placed in an attempt record or
  /// resolver body.
  Future<String?> authenticatedUserId() async {
    final accessToken = await _secureStorage.read(key: accessTokenKey);
    if (accessToken == null || accessToken.isEmpty) return null;
    return userIdFromAccessToken(accessToken);
  }

  /// Resolves all unresolved attempts in order. A resolver call only checks
  /// state; it never resubmits the original financial mutation.
  /// Reports every checked result through [onResolved], including terminal
  /// outcomes that are no longer returned in the unresolved list.
  Future<List<PaymentAttempt>> restoreAndResolve(
    String userId, {
    void Function(PaymentAttempt)? onResolved,
  }) async {
    final unresolved = await _store.loadUnresolved(userId);
    final resolved = <PaymentAttempt>[];
    for (final attempt in unresolved) {
      final result = await resolveAttempt(userId: userId, attempt: attempt);
      onResolved?.call(result);
      if (result.isUnresolved) resolved.add(result);
    }
    return List<PaymentAttempt>.unmodifiable(resolved);
  }

  /// Checks one attempt against the authenticated backend resolver.
  ///
  /// The resolver idempotency key is intentionally new for every call. It is
  /// a cache-control/request-deduplication key for the read-only check and is
  /// never the original payment attempt key.
  Future<PaymentAttempt> resolveAttempt({
    required String userId,
    required PaymentAttempt attempt,
  }) async {
    if (attempt.userId.trim() != userId.trim()) {
      throw const PaymentRecoveryException(
        'Payment attempt does not belong to this account.',
      );
    }
    if (attempt.state.isTerminal) return attempt;

    try {
      final response = await _apiClient.client.post<dynamic>(
        '/api/payment-attempts/resolve',
        options: Options(
          headers: {'Idempotency-Key': _freshResolverKey()},
        ),
        data: {
          'operation': attempt.operation.wireName,
          'attemptKey': attempt.attemptKey,
        },
      );

      final data = _asMap(response.data);
      final state = PaymentAttemptState.fromWire('${data['state'] ?? ''}');
      final reference = data['reference'];
      final normalizedReference =
          reference is String && reference.trim().isNotEmpty
              ? reference.trim()
              : null;
      final resolverStateIsAllowed = state != null &&
          state != PaymentAttemptState.prepared &&
          state != PaymentAttemptState.submitted;
      if (!resolverStateIsAllowed ||
          (state.isTerminal && normalizedReference == null)) {
        // A malformed resolver response is an unknown outcome, never a
        // client-side assertion that the payment failed.
        return _recordUnknown(userId, attempt);
      }

      return _store.recordServerState(
        userId: userId,
        attemptKey: attempt.attemptKey,
        state: state,
        reference: normalizedReference,
      );
    } on DioException {
      // A timeout, 404, expired cache entry or other transport error does not
      // prove a financial failure. PREPARED/SUBMITTED become UNKNOWN so the
      // journal clearly tells the user that the original result is unresolved;
      // an already-PENDING attempt retains its stronger known state.
      if (attempt.state == PaymentAttemptState.prepared ||
          attempt.state == PaymentAttemptState.submitted) {
        return _recordUnknown(userId, attempt);
      }
      return attempt;
    } on PaymentAttemptStoreException {
      rethrow;
    } catch (_) {
      // Parsing or an unexpected resolver failure is handled with the same
      // conservative state transition as a transport error.
      if (attempt.state == PaymentAttemptState.prepared ||
          attempt.state == PaymentAttemptState.submitted) {
        return _recordUnknown(userId, attempt);
      }
      return attempt;
    }
  }

  String _freshResolverKey() {
    final key = _requestKeyGenerator().trim();
    if (key.isEmpty) {
      throw const PaymentRecoveryException(
        'Could not create a resolver request key.',
      );
    }
    return key;
  }

  Future<PaymentAttempt> _recordUnknown(
    String userId,
    PaymentAttempt attempt,
  ) {
    return _store.recordServerState(
      userId: userId,
      attemptKey: attempt.attemptKey,
      state: PaymentAttemptState.unknown,
      reference: attempt.reference,
    );
  }

  static Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return const <String, dynamic>{};
  }

  static String? userIdFromAccessToken(String token) {
    final segments = token.split('.');
    if (segments.length != 3) return null;

    try {
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(segments[1]))),
      );
      if (payload is! Map) return null;
      final subject = payload['sub'];
      if (subject is! String || subject.trim().isEmpty) return null;
      return subject.trim();
    } catch (_) {
      return null;
    }
  }
}

class PaymentRecoveryException implements Exception {
  const PaymentRecoveryException(this.message);

  final String message;

  @override
  String toString() => 'PaymentRecoveryException: $message';
}
