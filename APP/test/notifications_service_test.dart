import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/notifications/services/notifications_service.dart';
import 'package:trustpay_app/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      'trustpay_access_token': 'access-token',
    });
  });

  test('reads the customer inbox, filters audiences, and sorts newest first',
      () async {
    final adapter = _NotificationApiAdapter(
      notifications: [
        _notification(
          id: 'older',
          eventKey: 'exchange-funded:order-1',
          audience: 'USER:user-1',
          createdAt: '2026-10-01T10:00:00.000Z',
        ),
        _notification(
          id: 'admin-only',
          eventKey: 'exchange-funded:order-2',
          audience: 'ADMIN',
          createdAt: '2026-10-03T10:00:00.000Z',
        ),
        _notification(
          id: 'newer',
          eventKey: 'exchange-payout-completed:order-3',
          audience: 'USER:user-1',
          createdAt: '2026-10-04T10:00:00.000Z',
          readAt: '2026-10-04T11:00:00.000Z',
        ),
      ],
      unreadCount: 1,
    );
    final service = _service(adapter);

    final notifications = await service.fetchNotifications();

    expect(notifications.map((item) => item.id), ['newer', 'older']);
    expect(notifications.first.isRead, isTrue);
    expect(notifications.last.isExchangeUpdate, isTrue);
    expect(await service.fetchUnreadCount(), 1);
  });

  test('deduplicates replayed notification rows by id', () async {
    final duplicate = _notification(
      id: 'replayed',
      createdAt: '2026-10-04T10:00:00.000Z',
    );
    final adapter = _NotificationApiAdapter(
      notifications: [
        duplicate,
        {...duplicate, 'readAt': '2026-10-04T11:00:00.000Z'},
      ],
    );
    final service = _service(adapter);

    final notifications = await service.fetchNotifications();

    expect(notifications, hasLength(1));
    expect(notifications.single.id, 'replayed');
    expect(notifications.single.isRead, isTrue);
  });

  test('surfaces a missing inbox route instead of treating it as empty',
      () async {
    final adapter = _NotificationApiAdapter(
      notifications: const [],
      notificationsStatusCode: 404,
    );
    final service = _service(adapter);

    await expectLater(
      service.fetchNotifications(),
      throwsA(isA<DioException>()),
    );
  });

  test('uses the dedicated unread-count endpoint for older unread alerts',
      () async {
    final adapter = _NotificationApiAdapter(
      notifications: const [],
      unreadCount: 51,
    );
    final service = _service(adapter);

    expect(await service.fetchUnreadCount(), 51);
    expect(adapter.unreadCountRequests, 1);
    expect(adapter.notificationsRequests, 0);
  });

  test('retries a failed read with the same idempotency key', () async {
    final adapter = _NotificationApiAdapter(
      notifications: [_notification(id: 'n-1')],
      failReads: 1,
    );
    final service = _service(adapter);

    await expectLater(
      service.markRead('n-1'),
      throwsA(isA<DioException>()),
    );
    await service.markRead('n-1');

    expect(adapter.readIdempotencyKeys, hasLength(2));
    expect(
      adapter.readIdempotencyKeys.first,
      adapter.readIdempotencyKeys.last,
    );
    expect(adapter.readPaths,
        ['/api/notifications/n-1/read', '/api/notifications/n-1/read']);
  });

  test('rejects malformed notification payloads', () async {
    final adapter = _NotificationApiAdapter(
        notifications: const [], rawNotifications: {'not': 'an array'});
    final service = _service(adapter);

    await expectLater(
      service.fetchNotifications(),
      throwsA(isA<FormatException>()),
    );
  });

  test('rejects malformed unread-count payloads', () async {
    for (final payload in <dynamic>[
      const <String, dynamic>{},
      const <String, dynamic>{'unreadCount': '51'},
      const <String, dynamic>{'unreadCount': -1},
      const <String, dynamic>{'unreadCount': 1.5},
      const <dynamic>[],
    ]) {
      final adapter = _NotificationApiAdapter(
        notifications: const [],
        rawUnreadCount: payload,
      );
      final service = _service(adapter);

      await expectLater(
        service.fetchUnreadCount(),
        throwsA(isA<FormatException>()),
      );
    }
  });
}

NotificationsService _service(_NotificationApiAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: _NotificationApiAdapter.baseUrl))
    ..httpClientAdapter = adapter;
  return NotificationsService(apiClient: ApiClient(dio: dio));
}

Map<String, dynamic> _notification({
  required String id,
  String eventKey = 'exchange-payment-submitted:order-1',
  String audience = 'USER:user-1',
  String createdAt = '2026-10-02T10:00:00.000Z',
  String? readAt,
}) {
  return {
    'id': id,
    'eventKey': eventKey,
    'audience': audience,
    'orderId': 'order-1',
    'title': 'Exchange payment update',
    'createdAt': createdAt,
    'readAt': readAt,
  };
}

class _NotificationApiAdapter implements HttpClientAdapter {
  static const baseUrl = 'https://notifications.test';

  final List<Map<String, dynamic>> notifications;
  final dynamic rawNotifications;
  final int notificationsStatusCode;
  final int unreadCount;
  final dynamic rawUnreadCount;
  int failReads;
  int notificationsRequests = 0;
  int unreadCountRequests = 0;
  final List<String> readIdempotencyKeys = [];
  final List<String> readPaths = [];

  _NotificationApiAdapter({
    required this.notifications,
    this.rawNotifications,
    this.notificationsStatusCode = 200,
    this.unreadCount = 0,
    this.rawUnreadCount,
    this.failReads = 0,
  });

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;
    if (options.method == 'GET' && path == '/api/notifications') {
      notificationsRequests++;
      return _response(
        rawNotifications ?? notifications,
        statusCode: notificationsStatusCode,
      );
    }
    if (options.method == 'GET' && path == '/api/notifications/unread-count') {
      unreadCountRequests++;
      return _response(rawUnreadCount ?? {'unreadCount': unreadCount});
    }
    if (options.method == 'POST' && path.endsWith('/read')) {
      readPaths.add(path);
      readIdempotencyKeys.add(
        '${options.headers['Idempotency-Key'] ?? ''}',
      );
      if (failReads > 0) {
        failReads--;
        return _response({'message': 'temporary outage'}, statusCode: 503);
      }
      return _response({
        'notificationId': path.split('/')[3],
        'readAt': '2026-10-05T10:00:00.000Z',
      });
    }
    return _response({'message': 'not found'}, statusCode: 404);
  }

  ResponseBody _response(Object body, {int statusCode = 200}) {
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
