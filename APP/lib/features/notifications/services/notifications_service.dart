import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';

import '../../../../services/api_client.dart';

/// A durable, server-owned notification visible to the authenticated user.
///
/// Notifications are deliberately separate from [HomeDashboardData]. They
/// have their own read state and can arrive after a dashboard response has
/// already been cached.
class TrustPayNotification {
  final String id;
  final String eventKey;
  final String audience;
  final String? orderId;
  final String title;
  final DateTime createdAt;
  final DateTime? readAt;

  const TrustPayNotification({
    required this.id,
    required this.eventKey,
    required this.audience,
    required this.orderId,
    required this.title,
    required this.createdAt,
    required this.readAt,
  });

  factory TrustPayNotification.fromJson(Map<String, dynamic> json) {
    final orderIdValue = json['orderId'];
    if (orderIdValue != null && orderIdValue is! String) {
      throw const FormatException('Invalid notification order id.');
    }

    final readAtValue = json['readAt'];
    final readAt = _parseNullableDate(readAtValue, 'notification read time');
    final createdAt = _parseRequiredDate(
      json['createdAt'],
      'notification creation time',
    );

    return TrustPayNotification(
      id: _requiredText(json['id'], 'notification id'),
      eventKey: _requiredText(json['eventKey'], 'notification event key'),
      audience: _requiredText(json['audience'], 'notification audience'),
      orderId: _nullableText(orderIdValue),
      title: _requiredText(json['title'], 'notification title'),
      createdAt: createdAt,
      readAt: readAt,
    );
  }

  bool get isRead => readAt != null;

  /// The customer API is scoped server-side to the authenticated user's
  /// `USER:<userId>` audience. Keep a defensive client-side check so a
  /// mis-scoped admin notification can never be rendered in the customer app.
  bool get isCustomerAudience {
    final value = audience.trim();
    return value.startsWith('USER:') && value.length > 'USER:'.length;
  }

  /// Exchange notifications have a safe deep link to the manual order route.
  /// Generic activity (for example a wallet transaction) is intentionally not
  /// converted into a notification here, preventing duplicate activity cards.
  bool get isExchangeUpdate {
    final value = eventKey.toUpperCase();
    return value.contains('EXCHANGE') || value.contains('MANUAL_EXCHANGE');
  }

  TrustPayNotification copyWith({DateTime? readAt}) {
    return TrustPayNotification(
      id: id,
      eventKey: eventKey,
      audience: audience,
      orderId: orderId,
      title: title,
      createdAt: createdAt,
      readAt: readAt ?? this.readAt,
    );
  }
}

class NotificationReadRecord {
  final String notificationId;
  final DateTime readAt;

  const NotificationReadRecord({
    required this.notificationId,
    required this.readAt,
  });

  factory NotificationReadRecord.fromJson(
    Map<String, dynamic> json, {
    required String fallbackId,
  }) {
    final notificationId = _nullableText(json['notificationId']) ??
        _nullableText(json['id']) ??
        fallbackId;
    final readAt = _parseRequiredDate(
      json['readAt'],
      'notification read time',
    );
    return NotificationReadRecord(
      notificationId: notificationId,
      readAt: readAt,
    );
  }
}

/// API client for the customer notification inbox.
///
/// The read-key cache is intentionally owned by this service instance. A
/// failed read can therefore be retried with the same `Idempotency-Key`,
/// while a separate notification gets a separate key. This mirrors the
/// backend's durable upsert contract and prevents duplicate read records.
class NotificationsService {
  NotificationsService({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;
  final Map<String, String> _readIdempotencyKeys = <String, String>{};
  static const _uuid = Uuid();

  Future<List<TrustPayNotification>> fetchNotifications() async {
    final response = await _apiClient.client.get('/api/notifications');

    final payload = response.data;
    if (payload is! List) {
      throw const FormatException(
        'Invalid notifications response: expected an array.',
      );
    }

    final notificationsById = <String, TrustPayNotification>{};
    for (final item in payload) {
      if (item is! Map) {
        throw const FormatException('Invalid notification item.');
      }
      final notification = TrustPayNotification.fromJson(
        Map<String, dynamic>.from(item),
      );
      // The server returns customer-scoped rows. This second check protects
      // the customer surface if a mixed audience ever reaches the client.
      if (!notification.isCustomerAudience) continue;

      final previous = notificationsById[notification.id];
      if (previous == null) {
        notificationsById[notification.id] = notification;
      } else if (!previous.isRead && notification.isRead) {
        // A replayed row must not duplicate the card. Preserve a durable read
        // state if either copy contains the server's read record.
        notificationsById[notification.id] =
            previous.copyWith(readAt: notification.readAt);
      }
    }

    final ordered = [...notificationsById.values]
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return ordered;
  }

  Future<int> fetchUnreadCount() async {
    final response =
        await _apiClient.client.get('/api/notifications/unread-count');
    final payload = response.data;
    if (payload is! Map) {
      throw const FormatException(
        'Invalid unread notifications response: expected a record.',
      );
    }

    final value = payload['unreadCount'];
    if (value is! num ||
        !value.isFinite ||
        value < 0 ||
        value != value.round()) {
      throw const FormatException(
        'Invalid unread notifications response: expected a non-negative integer.',
      );
    }

    return value.toInt();
  }

  Future<NotificationReadRecord> markRead(
    String notificationId, {
    String? idempotencyKey,
  }) async {
    final id = _validatedId(notificationId);
    final suppliedKey = idempotencyKey?.trim();
    final stableKey = suppliedKey == null || suppliedKey.isEmpty
        ? _readIdempotencyKeys.putIfAbsent(id, _uuid.v4)
        : suppliedKey;
    _readIdempotencyKeys[id] = stableKey;
    final response = await _apiClient.client.post<dynamic>(
      '/api/notifications/${Uri.encodeComponent(id)}/read',
      data: const <String, dynamic>{},
      options: Options(
        headers: <String, String>{'Idempotency-Key': stableKey},
      ),
    );

    final payload = response.data;
    if (payload is! Map) {
      throw const FormatException(
        'Invalid notification read response: expected a record.',
      );
    }
    return NotificationReadRecord.fromJson(
      Map<String, dynamic>.from(payload),
      fallbackId: id,
    );
  }

  String idempotencyKeyForRead(String notificationId) {
    final id = _validatedId(notificationId);
    return _readIdempotencyKeys.putIfAbsent(id, _uuid.v4);
  }
}

String _requiredText(dynamic value, String field) {
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid $field.');
  }
  return value.trim();
}

String? _nullableText(dynamic value) {
  if (value == null) return null;
  if (value is! String) {
    throw const FormatException('Invalid notification text value.');
  }
  final normalized = value.trim();
  return normalized.isEmpty ? null : normalized;
}

DateTime _parseRequiredDate(dynamic value, String field) {
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid $field.');
  }
  final parsed = DateTime.tryParse(value);
  if (parsed == null) throw FormatException('Invalid $field.');
  return parsed.toUtc();
}

DateTime? _parseNullableDate(dynamic value, String field) {
  if (value == null) return null;
  return _parseRequiredDate(value, field);
}

String _validatedId(String value) {
  final normalized = value.trim();
  if (normalized.isEmpty ||
      normalized.length > 128 ||
      normalized.contains('/')) {
    throw ArgumentError.value(
        value, 'notificationId', 'Invalid notification id.');
  }
  return normalized;
}
