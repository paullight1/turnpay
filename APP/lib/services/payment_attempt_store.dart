import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// The secondary money mutation families understood by the recovery resolver.
///
/// The wire values intentionally match the backend contract. Individual VTU
/// products (airtime, data, cable and electricity) all use VTU_PURCHASE.
enum PaymentAttemptOperation {
  internalTransfer('INTERNAL_TRANSFER'),
  withdrawal('WITHDRAWAL'),
  vtuPurchase('VTU_PURCHASE');

  const PaymentAttemptOperation(this.wireName);

  final String wireName;

  static PaymentAttemptOperation? fromWire(String value) {
    final normalized = value.trim().toUpperCase();
    for (final operation in values) {
      if (operation.wireName == normalized) return operation;
    }
    return null;
  }
}

/// Journal states are deliberately conservative. A transport error only
/// moves an attempt to UNKNOWN; it never proves that a payment failed.
enum PaymentAttemptState {
  prepared('PREPARED'),
  submitted('SUBMITTED'),
  unknown('UNKNOWN'),
  pending('PENDING'),
  success('SUCCESS'),
  failed('FAILED'),
  reversed('REVERSED');

  const PaymentAttemptState(this.wireName);

  final String wireName;

  bool get isTerminal => const {
        PaymentAttemptState.success,
        PaymentAttemptState.failed,
        PaymentAttemptState.reversed,
      }.contains(this);

  bool get isUnresolved => !isTerminal;

  static PaymentAttemptState? fromWire(String value) {
    final normalized = value.trim().toUpperCase();
    for (final state in values) {
      if (state.wireName == normalized) return state;
    }
    return null;
  }
}

/// A small abstraction keeps the production store on encrypted platform
/// storage while allowing deterministic, user-scoped tests.
abstract interface class PaymentAttemptStorage {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

class FlutterSecurePaymentAttemptStorage implements PaymentAttemptStorage {
  FlutterSecurePaymentAttemptStorage({FlutterSecureStorage? storage})
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

/// In-memory storage intended for unit/widget tests. It has the same async
/// surface as [FlutterSecurePaymentAttemptStorage] so tests exercise the
/// journal's serialization and failure behavior.
class MemoryPaymentAttemptStorage implements PaymentAttemptStorage {
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

class PaymentAttemptStoreException implements Exception {
  const PaymentAttemptStoreException(this.message);

  final String message;

  @override
  String toString() => 'PaymentAttemptStoreException: $message';
}

class PaymentAttempt {
  PaymentAttempt({
    required this.userId,
    required this.attemptKey,
    required this.operation,
    required Map<String, dynamic> canonicalPayload,
    required this.fingerprint,
    required this.state,
    required this.createdAt,
    required this.updatedAt,
    this.reference,
  }) : canonicalPayload = _copyMap(canonicalPayload);

  final String userId;
  final String attemptKey;
  final PaymentAttemptOperation operation;
  final Map<String, dynamic> canonicalPayload;
  final String fingerprint;
  final PaymentAttemptState state;
  final String? reference;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isUnresolved => state.isUnresolved;

  PaymentAttempt copyWith({
    PaymentAttemptState? state,
    String? reference,
    bool clearReference = false,
    DateTime? updatedAt,
  }) {
    return PaymentAttempt(
      userId: userId,
      attemptKey: attemptKey,
      operation: operation,
      canonicalPayload: canonicalPayload,
      fingerprint: fingerprint,
      state: state ?? this.state,
      reference: clearReference ? null : (reference ?? this.reference),
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'attemptKey': attemptKey,
      'operation': operation.wireName,
      'canonicalPayload': _copyMap(canonicalPayload),
      'fingerprint': fingerprint,
      'state': state.wireName,
      if (reference != null && reference!.isNotEmpty) 'reference': reference,
      'createdAt': createdAt.toUtc().toIso8601String(),
      'updatedAt': updatedAt.toUtc().toIso8601String(),
    };
  }

  factory PaymentAttempt.fromJson(Object? raw, {required String userId}) {
    if (raw is! Map) {
      throw const PaymentAttemptStoreException(
          'Stored attempt is not an object.');
    }

    final storedUserId = _readString(raw['userId']);
    final attemptKey = _readString(raw['attemptKey']);
    final operation = PaymentAttemptOperation.fromWire(
      _readString(raw['operation']),
    );
    final payload = raw['canonicalPayload'];
    final fingerprint = _readString(raw['fingerprint']);
    final state = PaymentAttemptState.fromWire(_readString(raw['state']));
    final createdAt = DateTime.tryParse(_readString(raw['createdAt']))?.toUtc();
    final updatedAt = DateTime.tryParse(_readString(raw['updatedAt']))?.toUtc();

    if (storedUserId != userId ||
        attemptKey.isEmpty ||
        operation == null ||
        payload is! Map ||
        fingerprint.isEmpty ||
        state == null ||
        createdAt == null ||
        updatedAt == null) {
      throw const PaymentAttemptStoreException('Stored attempt is invalid.');
    }

    final canonicalPayload = _canonicalizePayload(
      Map<String, dynamic>.from(payload),
    );
    if (_fingerprint(canonicalPayload) != fingerprint) {
      throw const PaymentAttemptStoreException(
        'Stored attempt payload does not match its fingerprint.',
      );
    }

    final reference = raw['reference'];
    return PaymentAttempt(
      userId: storedUserId,
      attemptKey: attemptKey,
      operation: operation,
      canonicalPayload: canonicalPayload,
      fingerprint: fingerprint,
      state: state,
      reference: reference is String && reference.trim().isNotEmpty
          ? reference.trim()
          : null,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }
}

/// Durable, account-scoped payment attempt journal.
///
/// Values are stored through [FlutterSecureStorage] by default, which gives
/// the journal encrypted-at-rest platform storage. The payload is sanitized
/// before serialization so PINs, OTPs, bearer tokens and other credentials can
/// never become part of the recovery record.
class PaymentAttemptStore {
  PaymentAttemptStore({
    PaymentAttemptStorage? storage,
    String Function()? keyGenerator,
    DateTime Function()? now,
  })  : _storage = storage ?? FlutterSecurePaymentAttemptStorage(),
        _keyGenerator = keyGenerator ?? _uuid.v4,
        _now = now ?? (() => DateTime.now().toUtc());

  static const String storagePrefix = 'trustpay_payment_attempts_v1_';
  static const Uuid _uuid = Uuid();
  static final Map<String, Future<void>> _queuesByUser =
      <String, Future<void>>{};

  final PaymentAttemptStorage _storage;
  final String Function() _keyGenerator;
  final DateTime Function() _now;

  /// Exposed for tests and diagnostics without revealing the account ID in a
  /// secure-storage key.
  String storageKeyForUser(String userId) {
    final normalized = _normalizeUserId(userId);
    return '$storagePrefix${sha256.convert(utf8.encode(normalized))}';
  }

  /// Returns the digest used to match a recreated visible payment attempt.
  /// Sensitive fields are removed using the same canonicalization as
  /// [prepare], so callers cannot accidentally fingerprint a PIN or token.
  String fingerprintForPayload(Map<String, dynamic> payload) {
    return _fingerprint(_canonicalizePayload(payload));
  }

  Future<String> prepare(
    String userId,
    PaymentAttemptOperation operation,
    Map<String, dynamic> canonicalPayload,
  ) {
    final normalizedUserId = _normalizeUserId(userId);
    return _enqueue(normalizedUserId, () async {
      final payload = _canonicalizePayload(canonicalPayload);
      final fingerprint = _fingerprint(payload);
      final attempts = await _readAttempts(normalizedUserId);
      final existing = attempts.where(
        (attempt) =>
            attempt.isUnresolved &&
            attempt.operation == operation &&
            attempt.fingerprint == fingerprint,
      );
      if (existing.isNotEmpty) return existing.first.attemptKey;

      final key = _keyGenerator().trim();
      if (key.isEmpty) {
        throw const PaymentAttemptStoreException(
          'Could not create a payment attempt key.',
        );
      }

      final now = _now().toUtc();
      attempts.add(
        PaymentAttempt(
          userId: normalizedUserId,
          attemptKey: key,
          operation: operation,
          canonicalPayload: payload,
          fingerprint: fingerprint,
          state: PaymentAttemptState.prepared,
          createdAt: now,
          updatedAt: now,
        ),
      );
      await _writeAttempts(normalizedUserId, attempts);
      return key;
    });
  }

  Future<PaymentAttempt?> findUnresolved(
    String userId,
    PaymentAttemptOperation operation,
    Map<String, dynamic> canonicalPayload,
  ) {
    final normalizedUserId = _normalizeUserId(userId);
    return _enqueue(normalizedUserId, () async {
      final fingerprint = _fingerprint(_canonicalizePayload(canonicalPayload));
      final attempts = await _readAttempts(normalizedUserId);
      for (final attempt in attempts) {
        if (attempt.isUnresolved &&
            attempt.operation == operation &&
            attempt.fingerprint == fingerprint) {
          return attempt;
        }
      }
      return null;
    });
  }

  Future<List<PaymentAttempt>> loadUnresolved(String userId) {
    final normalizedUserId = _normalizeUserId(userId);
    return _enqueue(normalizedUserId, () async {
      final attempts = await _readAttempts(normalizedUserId);
      return List<PaymentAttempt>.unmodifiable(
        attempts.where((attempt) => attempt.isUnresolved),
      );
    });
  }

  Future<List<PaymentAttempt>> loadAll(String userId) {
    final normalizedUserId = _normalizeUserId(userId);
    return _enqueue(normalizedUserId, () async {
      return List<PaymentAttempt>.unmodifiable(
        await _readAttempts(normalizedUserId),
      );
    });
  }

  Future<PaymentAttempt> markSubmitted(String userId, String attemptKey) {
    final normalizedUserId = _normalizeUserId(userId);
    return _enqueue(normalizedUserId, () async {
      final attempts = await _readAttempts(normalizedUserId);
      final index = _indexOf(attempts, attemptKey);
      final current = attempts[index];
      if (current.state.isTerminal) return current;
      final updated = current.copyWith(
        state: PaymentAttemptState.submitted,
        updatedAt: _now().toUtc(),
      );
      attempts[index] = updated;
      await _writeAttempts(normalizedUserId, attempts);
      return updated;
    });
  }

  Future<PaymentAttempt> recordServerState({
    required String userId,
    required String attemptKey,
    required PaymentAttemptState state,
    String? reference,
  }) {
    final normalizedUserId = _normalizeUserId(userId);
    return _enqueue(normalizedUserId, () async {
      final attempts = await _readAttempts(normalizedUserId);
      final index = _indexOf(attempts, attemptKey);
      final current = attempts[index];

      if (current.state.isTerminal && current.state != state) {
        throw const PaymentAttemptStoreException(
          'A terminal payment outcome cannot be replaced.',
        );
      }

      final normalizedReference = reference?.trim();
      final updated = current.copyWith(
        state: state,
        reference: normalizedReference == null || normalizedReference.isEmpty
            ? null
            : normalizedReference,
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
        // Remove settled tails so a future widget/test zone does not chain
        // onto an already-completed Future created by an earlier zone.
        if (identical(_queuesByUser[queueKey], next)) {
          _queuesByUser.remove(queueKey);
        }
      }
    });
  }

  Future<List<PaymentAttempt>> _readAttempts(String userId) async {
    final raw = await _storage.read(storageKeyForUser(userId));
    if (raw == null || raw.trim().isEmpty) return <PaymentAttempt>[];

    dynamic decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      throw const PaymentAttemptStoreException(
        'Payment recovery data could not be read safely.',
      );
    }

    if (decoded is! List) {
      throw const PaymentAttemptStoreException(
        'Payment recovery data has an invalid shape.',
      );
    }

    return decoded
        .map(
          (item) => PaymentAttempt.fromJson(item, userId: userId),
        )
        .toList(growable: true);
  }

  Future<void> _writeAttempts(
    String userId,
    List<PaymentAttempt> attempts,
  ) async {
    final encoded =
        jsonEncode(attempts.map((attempt) => attempt.toJson()).toList());
    await _storage.write(storageKeyForUser(userId), encoded);
  }

  int _indexOf(List<PaymentAttempt> attempts, String attemptKey) {
    final normalizedKey = attemptKey.trim();
    final index =
        attempts.indexWhere((attempt) => attempt.attemptKey == normalizedKey);
    if (index < 0) {
      throw const PaymentAttemptStoreException(
          'Payment attempt was not found.');
    }
    return index;
  }

  static String _normalizeUserId(String userId) {
    final normalized = userId.trim();
    if (normalized.isEmpty) {
      throw const PaymentAttemptStoreException(
        'An authenticated account is required for payment recovery.',
      );
    }
    return normalized;
  }
}

Map<String, dynamic> _canonicalizePayload(Map<String, dynamic> payload) {
  final canonical = _canonicalizeValue(payload);
  if (canonical is! Map<String, dynamic>) {
    throw const PaymentAttemptStoreException(
        'Payment payload must be an object.');
  }
  return canonical;
}

dynamic _canonicalizeValue(dynamic value, {String? key}) {
  if (key != null && _isSensitiveKey(key)) {
    return _omitted;
  }

  if (value is Map) {
    final entries = <String, dynamic>{};
    for (final entry in value.entries) {
      final entryKey = '${entry.key}'.trim();
      if (entryKey.isEmpty || _isSensitiveKey(entryKey)) continue;
      final canonicalValue = _canonicalizeValue(entry.value, key: entryKey);
      if (!identical(canonicalValue, _omitted)) {
        entries[entryKey] = canonicalValue;
      }
    }
    final sortedKeys = entries.keys.toList()..sort();
    return <String, dynamic>{
      for (final entryKey in sortedKeys) entryKey: entries[entryKey],
    };
  }

  if (value is List) {
    return [
      for (final item in value)
        if (!identical(item, _omitted)) _canonicalizeValue(item),
    ];
  }

  if (value == null || value is String || value is num || value is bool) {
    return value;
  }

  throw const PaymentAttemptStoreException(
    'Payment payload contains an unsupported value.',
  );
}

final Object _omitted = Object();

bool _isSensitiveKey(String key) {
  final normalized = key.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
  return normalized.contains('pin') ||
      normalized.contains('otp') ||
      normalized.contains('token') ||
      normalized.contains('authorization') ||
      normalized.contains('password') ||
      normalized.contains('secret') ||
      normalized.contains('apikey');
}

String _fingerprint(Map<String, dynamic> payload) {
  return sha256.convert(utf8.encode(jsonEncode(payload))).toString();
}

String _readString(Object? value) => value is String ? value.trim() : '';

Map<String, dynamic> _copyMap(Map<String, dynamic> value) {
  final copied = _canonicalizePayload(value);
  return Map<String, dynamic>.from(copied);
}
