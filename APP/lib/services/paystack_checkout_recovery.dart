import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import 'wallet_service.dart';

/// Durable states for the server-owned Paystack funding transaction.
///
/// A prepared attempt has a stable idempotency key but may not have a
/// provider reference yet (for example, when the initialize response was
/// lost). A pending attempt always has a reference and may be verified after
/// an app restart. Terminal records are retained so a completed attempt is
/// never mistaken for a new payment.
enum PaystackCheckoutAttemptState {
  prepared('PREPARED'),
  pending('PENDING'),
  success('SUCCESS'),
  failed('FAILED');

  const PaystackCheckoutAttemptState(this.wireName);

  final String wireName;

  bool get isTerminal =>
      this == PaystackCheckoutAttemptState.success ||
      this == PaystackCheckoutAttemptState.failed;

  bool get isUnresolved => !isTerminal;

  static PaystackCheckoutAttemptState? fromWire(String value) {
    final normalized = value.trim().toUpperCase();
    for (final state in values) {
      if (state.wireName == normalized) return state;
    }
    return null;
  }
}

abstract interface class PaystackCheckoutStorage {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

class FlutterSecurePaystackCheckoutStorage implements PaystackCheckoutStorage {
  FlutterSecurePaystackCheckoutStorage({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// In-memory storage for focused unit tests. Production defaults to encrypted
/// [FlutterSecureStorage], never shared preferences.
class MemoryPaystackCheckoutStorage implements PaystackCheckoutStorage {
  final Map<String, String> values = <String, String>{};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

class PaystackCheckoutAttemptStoreException implements Exception {
  const PaystackCheckoutAttemptStoreException(this.message);

  final String message;

  @override
  String toString() => 'PaystackCheckoutAttemptStoreException: $message';
}

class PaystackCheckoutConflictException
    implements PaystackCheckoutAttemptStoreException {
  const PaystackCheckoutConflictException(this.attempt)
      : message =
            'Another Paystack checkout is unresolved for this account. Check its status before starting another payment.';

  final PaystackCheckoutAttempt attempt;

  @override
  final String message;

  @override
  String toString() => 'PaystackCheckoutConflictException: $message';
}

class PaystackCheckoutRecoveryException implements Exception {
  const PaystackCheckoutRecoveryException(this.message);

  final String message;

  @override
  String toString() => 'PaystackCheckoutRecoveryException: $message';
}

class PaystackCheckoutAttempt {
  PaystackCheckoutAttempt({
    required this.userId,
    required this.attemptKey,
    required this.amount,
    required this.currency,
    required this.state,
    required this.createdAt,
    required this.updatedAt,
    this.reference,
    this.authorizationUrl,
  });

  final String userId;
  final String attemptKey;
  final String amount;
  final String currency;
  final PaystackCheckoutAttemptState state;
  final String? reference;
  final Uri? authorizationUrl;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isUnresolved => state.isUnresolved;

  PaystackCheckoutAttempt copyWith({
    PaystackCheckoutAttemptState? state,
    String? reference,
    bool clearReference = false,
    Uri? authorizationUrl,
    bool clearAuthorizationUrl = false,
    DateTime? updatedAt,
  }) {
    return PaystackCheckoutAttempt(
      userId: userId,
      attemptKey: attemptKey,
      amount: amount,
      currency: currency,
      state: state ?? this.state,
      reference: clearReference ? null : (reference ?? this.reference),
      authorizationUrl: clearAuthorizationUrl
          ? null
          : (authorizationUrl ?? this.authorizationUrl),
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'userId': userId,
        'attemptKey': attemptKey,
        'amount': amount,
        'currency': currency,
        'state': state.wireName,
        if (reference != null && reference!.isNotEmpty) 'reference': reference,
        if (authorizationUrl != null)
          'authorizationUrl': authorizationUrl.toString(),
        'createdAt': createdAt.toUtc().toIso8601String(),
        'updatedAt': updatedAt.toUtc().toIso8601String(),
      };

  factory PaystackCheckoutAttempt.fromJson(
    Object? raw, {
    required String userId,
  }) {
    if (raw is! Map) {
      throw const PaystackCheckoutAttemptStoreException(
        'Stored Paystack checkout is not an object.',
      );
    }

    final storedUserId = _readString(raw['userId']);
    final attemptKey = _readString(raw['attemptKey']);
    final amount = _canonicalAmount(_readString(raw['amount']));
    final currency = _readString(raw['currency']).toUpperCase();
    final state = PaystackCheckoutAttemptState.fromWire(
      _readString(raw['state']),
    );
    final createdAt = DateTime.tryParse(_readString(raw['createdAt']))?.toUtc();
    final updatedAt = DateTime.tryParse(_readString(raw['updatedAt']))?.toUtc();
    final reference = _readString(raw['reference']);
    final authorizationUrl = _safeAuthorizationUrl(
      _readString(raw['authorizationUrl']),
    );

    if (storedUserId != userId ||
        attemptKey.isEmpty ||
        currency != 'NGN' ||
        state == null ||
        createdAt == null ||
        updatedAt == null ||
        ((state != PaystackCheckoutAttemptState.prepared &&
                state != PaystackCheckoutAttemptState.failed) &&
            reference.isEmpty) ||
        (_readString(raw['authorizationUrl']).isNotEmpty &&
            authorizationUrl == null)) {
      throw const PaystackCheckoutAttemptStoreException(
        'Stored Paystack checkout is invalid.',
      );
    }

    return PaystackCheckoutAttempt(
      userId: storedUserId,
      attemptKey: attemptKey,
      amount: amount,
      currency: currency,
      state: state,
      reference: reference.isEmpty ? null : reference,
      authorizationUrl: authorizationUrl,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }
}

/// Encrypted, account-scoped journal for the incoming Paystack checkout.
///
/// Only payment metadata required for safe recovery is persisted. Credentials,
/// OTPs, PINs, BVN/NIN values, bearer tokens and authorization headers are not
/// accepted by this model and therefore cannot enter its serialized record.
class PaystackCheckoutAttemptStore {
  PaystackCheckoutAttemptStore({
    PaystackCheckoutStorage? storage,
    String Function()? keyGenerator,
    DateTime Function()? now,
  })  : _storage = storage ?? FlutterSecurePaystackCheckoutStorage(),
        _keyGenerator = keyGenerator ?? _uuid.v4,
        _now = now ?? (() => DateTime.now().toUtc());

  static const String storagePrefix = 'trustpay_paystack_checkout_v1_';
  static const Uuid _uuid = Uuid();
  static final Map<String, Future<void>> _queuesByUser =
      <String, Future<void>>{};

  final PaystackCheckoutStorage _storage;
  final String Function() _keyGenerator;
  final DateTime Function() _now;

  String storageKeyForUser(String userId) {
    final normalized = _normalizeUserId(userId);
    return '$storagePrefix${sha256.convert(utf8.encode(normalized))}';
  }

  Future<PaystackCheckoutAttempt> prepare({
    required String userId,
    required String amount,
    String currency = 'NGN',
  }) {
    final normalizedUserId = _normalizeUserId(userId);
    final normalizedCurrency = currency.trim().toUpperCase();
    if (normalizedCurrency != 'NGN') {
      throw const PaystackCheckoutAttemptStoreException(
        'Paystack checkout only supports NGN.',
      );
    }
    final normalizedAmount = _canonicalAmount(amount);

    return _enqueue(normalizedUserId, () async {
      final attempts = await _readAttempts(normalizedUserId);
      final unresolved = attempts.where((attempt) => attempt.isUnresolved);
      for (final attempt in unresolved) {
        if (attempt.currency == normalizedCurrency &&
            attempt.amount == normalizedAmount) {
          return attempt;
        }
      }
      final existing = unresolved.firstOrNull;
      if (existing != null) {
        throw PaystackCheckoutConflictException(existing);
      }

      final attemptKey = _keyGenerator().trim();
      if (attemptKey.isEmpty) {
        throw const PaystackCheckoutAttemptStoreException(
          'Could not create a Paystack checkout key.',
        );
      }
      final now = _now().toUtc();
      final attempt = PaystackCheckoutAttempt(
        userId: normalizedUserId,
        attemptKey: attemptKey,
        amount: normalizedAmount,
        currency: normalizedCurrency,
        state: PaystackCheckoutAttemptState.prepared,
        createdAt: now,
        updatedAt: now,
      );
      attempts.add(attempt);
      await _writeAttempts(normalizedUserId, attempts);
      return attempt;
    });
  }

  Future<PaystackCheckoutAttempt?> findUnresolved(String userId) {
    final normalizedUserId = _normalizeUserId(userId);
    return _enqueue(normalizedUserId, () async {
      final attempts = await _readAttempts(normalizedUserId);
      for (final attempt in attempts) {
        if (attempt.isUnresolved) return attempt;
      }
      return null;
    });
  }

  Future<PaystackCheckoutAttempt> recordServerState({
    required String userId,
    required String attemptKey,
    required PaystackCheckoutAttemptState state,
    String? reference,
    Uri? authorizationUrl,
  }) {
    final normalizedUserId = _normalizeUserId(userId);
    return _enqueue(normalizedUserId, () async {
      final attempts = await _readAttempts(normalizedUserId);
      final index = _indexOf(attempts, attemptKey);
      final current = attempts[index];
      final normalizedReference = reference?.trim();
      final currentReference = current.reference?.trim();
      final normalizedAuthorizationUrl = authorizationUrl == null
          ? null
          : _safeAuthorizationUrl(authorizationUrl.toString());
      if (authorizationUrl != null && normalizedAuthorizationUrl == null) {
        throw const PaystackCheckoutAttemptStoreException(
          'A Paystack checkout URL is not a safe hosted destination.',
        );
      }
      final effectiveAuthorizationUrl =
          normalizedAuthorizationUrl ?? current.authorizationUrl;

      if (current.state == PaystackCheckoutAttemptState.success &&
          state != PaystackCheckoutAttemptState.success) {
        throw const PaystackCheckoutAttemptStoreException(
          'A successful Paystack checkout cannot be replaced.',
        );
      }
      if (current.state == PaystackCheckoutAttemptState.failed &&
          state == PaystackCheckoutAttemptState.success &&
          currentReference != normalizedReference) {
        throw const PaystackCheckoutAttemptStoreException(
          'A failed Paystack checkout can only be corrected for the same reference.',
        );
      }

      final effectiveReference = normalizedReference?.isNotEmpty == true
          ? normalizedReference
          : currentReference;
      if (state != PaystackCheckoutAttemptState.prepared &&
          state != PaystackCheckoutAttemptState.failed &&
          (effectiveReference == null || effectiveReference.isEmpty)) {
        throw const PaystackCheckoutAttemptStoreException(
          'A Paystack server state requires a provider reference.',
        );
      }
      if (currentReference != null &&
          effectiveReference != null &&
          currentReference != effectiveReference) {
        throw const PaystackCheckoutAttemptStoreException(
          'A Paystack provider reference cannot be replaced.',
        );
      }
      if (current.authorizationUrl != null &&
          effectiveAuthorizationUrl != null &&
          current.authorizationUrl != effectiveAuthorizationUrl) {
        throw const PaystackCheckoutAttemptStoreException(
          'A Paystack checkout URL cannot be replaced.',
        );
      }

      final updated = current.copyWith(
        state: state,
        reference: effectiveReference,
        authorizationUrl: effectiveAuthorizationUrl,
        updatedAt: _now().toUtc(),
      );
      attempts[index] = updated;
      await _writeAttempts(normalizedUserId, attempts);
      return updated;
    });
  }

  Future<T> _enqueue<T>(String userId, Future<T> Function() operation) {
    final queueKey = storageKeyForUser(userId);
    final previous = _queuesByUser[queueKey] ?? Future<void>.value();
    final completion = Completer<void>();
    final next = completion.future;
    _queuesByUser[queueKey] = next;

    return previous.then((_) async {
      try {
        return await operation();
      } finally {
        if (!completion.isCompleted) completion.complete();
        if (identical(_queuesByUser[queueKey], next)) {
          _queuesByUser.remove(queueKey);
        }
      }
    });
  }

  Future<List<PaystackCheckoutAttempt>> _readAttempts(String userId) async {
    final raw = await _storage.read(storageKeyForUser(userId));
    if (raw == null || raw.trim().isEmpty) {
      return <PaystackCheckoutAttempt>[];
    }

    dynamic decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      throw const PaystackCheckoutAttemptStoreException(
        'Paystack checkout recovery data could not be read safely.',
      );
    }
    if (decoded is! List) {
      throw const PaystackCheckoutAttemptStoreException(
        'Paystack checkout recovery data has an invalid shape.',
      );
    }

    return decoded
        .map(
          (item) => PaystackCheckoutAttempt.fromJson(item, userId: userId),
        )
        .toList(growable: true);
  }

  Future<void> _writeAttempts(
    String userId,
    List<PaystackCheckoutAttempt> attempts,
  ) async {
    await _storage.write(
      storageKeyForUser(userId),
      jsonEncode(attempts.map((attempt) => attempt.toJson()).toList()),
    );
  }

  int _indexOf(List<PaystackCheckoutAttempt> attempts, String attemptKey) {
    final normalizedKey = attemptKey.trim();
    final index =
        attempts.indexWhere((attempt) => attempt.attemptKey == normalizedKey);
    if (index < 0) {
      throw const PaystackCheckoutAttemptStoreException(
        'Paystack checkout attempt was not found.',
      );
    }
    return index;
  }

  static String _normalizeUserId(String userId) {
    final normalized = userId.trim();
    if (normalized.isEmpty) {
      throw const PaystackCheckoutAttemptStoreException(
        'An authenticated account is required for Paystack checkout recovery.',
      );
    }
    return normalized;
  }
}

typedef PaystackCheckoutInitializer = Future<PaystackCheckout> Function({
  required String amount,
  required String idempotencyKey,
});

typedef PaystackCheckoutVerifier = Future<PaystackPaymentStatus> Function(
  String reference,
);

class PaystackCheckoutInitializationResult {
  const PaystackCheckoutInitializationResult({
    required this.attempt,
    this.checkout,
    this.reusedExisting = false,
  });

  final PaystackCheckoutAttempt attempt;
  final PaystackCheckout? checkout;
  final bool reusedExisting;
}

/// Couples Paystack's server calls to the durable attempt journal.
///
/// The journal is written before initialization. If the response is lost,
/// the next call returns the same attempt key and therefore the same backend
/// transaction/reference. A restored reference is verified directly; it is
/// never initialized again.
class PaystackCheckoutRecoveryService {
  PaystackCheckoutRecoveryService({
    required PaystackCheckoutAttemptStore store,
    required PaystackCheckoutInitializer initialize,
    required PaystackCheckoutVerifier verify,
  })  : _store = store,
        _initialize = initialize,
        _verify = verify;

  final PaystackCheckoutAttemptStore _store;
  final PaystackCheckoutInitializer _initialize;
  final PaystackCheckoutVerifier _verify;

  PaystackCheckoutAttemptStore get store => _store;

  Future<PaystackCheckoutInitializationResult> initializeCheckout({
    required String userId,
    required String amount,
    String currency = 'NGN',
  }) async {
    final attempt = await _store.prepare(
      userId: userId,
      amount: amount,
      currency: currency,
    );
    final reference = attempt.reference;
    if (reference != null && reference.isNotEmpty) {
      return PaystackCheckoutInitializationResult(
        attempt: attempt,
        reusedExisting: true,
      );
    }

    late final PaystackCheckout checkout;
    try {
      checkout = await _initialize(
        amount: attempt.amount,
        idempotencyKey: attempt.attemptKey,
      );
    } catch (error) {
      if (_isDefiniteClientRejection(error)) {
        await _store.recordServerState(
          userId: userId,
          attemptKey: attempt.attemptKey,
          state: PaystackCheckoutAttemptState.failed,
        );
      }
      rethrow;
    }
    final checkoutReference = checkout.reference.trim();
    final state = PaystackCheckoutAttemptState.fromWire(checkout.status);
    if (checkoutReference.isEmpty ||
        state == null ||
        state == PaystackCheckoutAttemptState.prepared) {
      throw const PaystackCheckoutRecoveryException(
        'Paystack initialization did not return a verifiable payment reference.',
      );
    }

    final updated = await _store.recordServerState(
      userId: userId,
      attemptKey: attempt.attemptKey,
      state: state,
      reference: checkoutReference,
      authorizationUrl: checkout.authorizationUrl,
    );
    return PaystackCheckoutInitializationResult(
      attempt: updated,
      checkout: checkout,
    );
  }

  Future<PaystackCheckoutAttempt> verifyCheckout({
    required String userId,
    required PaystackCheckoutAttempt attempt,
  }) async {
    if (attempt.userId.trim() != userId.trim()) {
      throw const PaystackCheckoutRecoveryException(
        'Paystack checkout attempt does not belong to this account.',
      );
    }
    if (attempt.state.isTerminal ||
        attempt.reference == null ||
        attempt.reference!.isEmpty) {
      return attempt;
    }

    final status = await _verify(attempt.reference!);
    final returnedReference = status.reference.trim();
    if (returnedReference.isNotEmpty &&
        returnedReference != attempt.reference) {
      throw const PaystackCheckoutRecoveryException(
        'Paystack returned a different payment reference.',
      );
    }
    final state = PaystackCheckoutAttemptState.fromWire(status.status);
    if (state == null || state == PaystackCheckoutAttemptState.prepared) {
      throw const PaystackCheckoutRecoveryException(
        'Paystack returned an unknown payment state.',
      );
    }
    return _store.recordServerState(
      userId: userId,
      attemptKey: attempt.attemptKey,
      state: state,
      reference: attempt.reference,
    );
  }
}

String _readString(Object? value) => value is String ? value.trim() : '';

Uri? _safeAuthorizationUrl(String raw) {
  final value = raw.trim();
  if (value.isEmpty) return null;
  final uri = Uri.tryParse(value);
  if (uri == null ||
      uri.scheme.toLowerCase() != 'https' ||
      uri.userInfo.isNotEmpty ||
      uri.port != 443 ||
      uri.host.toLowerCase() != 'checkout.paystack.com') {
    return null;
  }
  return uri;
}

bool _isDefiniteClientRejection(Object error) {
  if (error is! DioException) return false;
  final statusCode = error.response?.statusCode ?? 0;
  return statusCode >= 400 && statusCode < 500;
}

String _canonicalAmount(String rawAmount) {
  final amount = rawAmount.trim().replaceAll(',', '');
  if (!RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(amount)) {
    throw const PaystackCheckoutAttemptStoreException(
      'Paystack checkout amount must be a positive NGN decimal.',
    );
  }
  final parts = amount.split('.');
  final whole = parts.first.replaceFirst(RegExp(r'^0+(?=\d)'), '');
  final fraction = parts.length == 1 ? '00' : parts[1].padRight(2, '0');
  if (whole == '0' && fraction == '00') {
    throw const PaystackCheckoutAttemptStoreException(
      'Paystack checkout amount must be greater than zero.',
    );
  }
  return '$whole.$fraction';
}
