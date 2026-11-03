import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/features/notifications/services/notifications_service.dart';
import 'package:trustpay_app/features/notifications/widgets/notification_inbox.dart';
import 'package:trustpay_app/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      'trustpay_access_token': 'access-token',
    });
  });

  testWidgets('keeps an unread card after a failed read and retries it',
      (tester) async {
    final adapter = _InboxApiAdapter(failReads: 1);
    final service = _service(adapter);

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(useMaterial3: true),
        home: NotificationInbox(
          service: service,
          pollInterval: const Duration(minutes: 5),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('Exchange payment confirmed'), findsOneWidget);
    expect(find.byTooltip('Mark as read'), findsOneWidget);

    await tester.tap(find.byTooltip('Mark as read'));
    await tester.pumpAndSettle();

    expect(
        find.text('Could not save this as read. Try again.'), findsOneWidget);
    expect(find.text('Exchange payment confirmed'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();

    expect(find.text('Could not save this as read. Try again.'), findsNothing);
    expect(find.byTooltip('Mark as read'), findsNothing);
    expect(adapter.readIdempotencyKeys, hasLength(2));
    expect(
      adapter.readIdempotencyKeys.first,
      adapter.readIdempotencyKeys.last,
    );
  });

  testWidgets(
      'refresh reconciles an ambiguous read commit without retrying the POST',
      (tester) async {
    final adapter = _InboxApiAdapter(
      failReads: 1,
      commitReadsBeforeFailure: true,
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(useMaterial3: true),
        home: NotificationInboxScreen(
          service: _service(adapter),
          pollInterval: const Duration(minutes: 5),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    await tester.tap(find.byTooltip('Mark as read'));
    await tester.pumpAndSettle();
    expect(
        find.text('Could not save this as read. Try again.'), findsOneWidget);

    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Refresh'));
    await tester.pumpAndSettle();

    expect(find.text('Could not save this as read. Try again.'), findsNothing);
    expect(find.byTooltip('Mark as read'), findsNothing);
    expect(adapter.readIdempotencyKeys, hasLength(1));
  });

  testWidgets('pauses polling while an exchange order covers the inbox',
      (tester) async {
    final adapter = _InboxApiAdapter();
    final router = GoRouter(
      initialLocation: '/inbox',
      observers: [appRouteObserver],
      routes: [
        GoRoute(
          path: '/inbox',
          builder: (context, state) => NotificationInbox(
            service: _service(adapter),
            pollInterval: const Duration(milliseconds: 50),
          ),
        ),
        GoRoute(
          path: '/exchange/orders/order-1',
          builder: (context, state) => const Scaffold(body: Text('Order')),
        ),
      ],
    );

    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    final inboxRoute = ModalRoute.of(
      tester.element(find.byType(NotificationInbox)),
    );
    expect(inboxRoute, isNotNull);
    expect(appRouteObserver.debugObservingRoute(inboxRoute!), isTrue);

    router.push('/exchange/orders/order-1');
    await tester.pumpAndSettle();
    final requestsAfterCover = adapter.notificationRequests;
    await tester.pump(const Duration(milliseconds: 100));
    expect(adapter.notificationRequests, requestsAfterCover);

    router.pop();
    await tester.pumpAndSettle();
    expect(adapter.notificationRequests, greaterThan(requestsAfterCover));
  });

  testWidgets('renders a durable empty state instead of transaction alerts',
      (tester) async {
    final adapter = _InboxApiAdapter(notifications: const []);

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(useMaterial3: true),
        home: NotificationInbox(
          service: _service(adapter),
          pollInterval: const Duration(minutes: 5),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('No notifications'), findsOneWidget);
    expect(
      find.text(
          'Account and payment updates will appear here when they are ready.'),
      findsOneWidget,
    );
    expect(find.text('No recent activity'), findsNothing);
    expect(find.text('Fund success'), findsNothing);
  });

  test('deep links only exchange events with safe order ids', () {
    final exchange = TrustPayNotification.fromJson({
      'id': 'n-1',
      'eventKey': 'exchange-payout-completed:order-1',
      'audience': 'USER:user-1',
      'orderId': 'order-1',
      'title': 'Payout completed',
      'createdAt': '2026-10-02T10:00:00.000Z',
      'readAt': null,
    });
    final generic = TrustPayNotification.fromJson({
      'id': 'n-2',
      'eventKey': 'wallet-transaction:tx-1',
      'audience': 'USER:user-1',
      'orderId': 'tx-1',
      'title': 'Wallet update',
      'createdAt': '2026-10-02T10:00:00.000Z',
      'readAt': null,
    });
    final unsafe = TrustPayNotification.fromJson({
      'id': 'n-3',
      'eventKey': 'exchange-payment-submitted:order-1',
      'audience': 'USER:user-1',
      'orderId': '../admin',
      'title': 'Exchange update',
      'createdAt': '2026-10-02T10:00:00.000Z',
      'readAt': null,
    });

    expect(notificationRouteFor(exchange), '/exchange/orders/order-1');
    expect(notificationRouteFor(generic), '/exchange');
    expect(notificationRouteFor(unsafe), '/exchange');
  });

  test('deep links BVN and receiving-account events to their owned screens',
      () {
    final bvnVerified = TrustPayNotification.fromJson({
      'id': 'n-4',
      'eventKey': 'kyc:bvn-verified:verification-1',
      'audience': 'USER:user-1',
      'title': 'BVN verified',
      'createdAt': '2026-10-02T10:00:00.000Z',
      'readAt': null,
    });
    final accountReady = TrustPayNotification.fromJson({
      'id': 'n-5',
      'eventKey': 'banking:account-ready:account-1',
      'audience': 'USER:user-1',
      'title': 'Receiving account ready',
      'createdAt': '2026-10-02T10:00:00.000Z',
      'readAt': null,
    });

    expect(notificationRouteFor(bvnVerified), AppRoutes.kyc);
    expect(notificationRouteFor(accountReady), AppRoutes.receiveMoney);
  });

  test('keeps malformed account event ids on the safe fallback route', () {
    final malformed = TrustPayNotification.fromJson({
      'id': 'n-6',
      'eventKey': 'banking:account-ready:../admin',
      'audience': 'USER:user-1',
      'title': 'Receiving account ready',
      'createdAt': '2026-10-02T10:00:00.000Z',
      'readAt': null,
    });

    expect(notificationRouteFor(malformed), AppRoutes.exchange);
  });
}

NotificationsService _service(_InboxApiAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: _InboxApiAdapter.baseUrl))
    ..httpClientAdapter = adapter;
  return NotificationsService(apiClient: ApiClient(dio: dio));
}

class _InboxApiAdapter implements HttpClientAdapter {
  static const baseUrl = 'https://notifications.test';

  int failReads;
  final bool commitReadsBeforeFailure;
  final List<Map<String, dynamic>> notifications;
  final List<String> readIdempotencyKeys = [];
  int notificationRequests = 0;

  _InboxApiAdapter({
    this.failReads = 0,
    this.commitReadsBeforeFailure = false,
    List<Map<String, dynamic>>? notifications,
  }) : notifications = notifications ??
            [
              {
                'id': 'n-1',
                'eventKey': 'exchange-payment-confirmed:order-1',
                'audience': 'USER:user-1',
                'orderId': 'order-1',
                'title': 'Exchange payment confirmed',
                'createdAt': '2026-10-02T10:00:00.000Z',
                'readAt': null,
              },
            ];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path;
    if (options.method == 'GET' && path == '/api/notifications') {
      notificationRequests++;
      return _response(notifications);
    }
    if (options.method == 'POST' && path.endsWith('/read')) {
      readIdempotencyKeys.add('${options.headers['Idempotency-Key'] ?? ''}');
      if (failReads > 0) {
        failReads--;
        if (commitReadsBeforeFailure) {
          for (var index = 0; index < notifications.length; index++) {
            if (notifications[index]['id'] == 'n-1') {
              notifications[index] = {
                ...notifications[index],
                'readAt': '2026-10-05T10:00:00.000Z',
              };
            }
          }
        }
        return _response({'message': 'temporary outage'}, statusCode: 503);
      }
      return _response({
        'notificationId': 'n-1',
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
