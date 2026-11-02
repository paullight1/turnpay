import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/home/screens/home_screen.dart';
import 'package:trustpay_app/features/notifications/services/notifications_service.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets('home bell shows the server unread notification count',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(
          homeDataService: bundle.homeDataService,
          notificationsService: _UnreadCountService(3),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('3'), findsOneWidget);
  });

  testWidgets('home bell refreshes its count on the bounded foreground poll',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final notifications = _UnreadCountService(1);

    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(
          homeDataService: bundle.homeDataService,
          notificationsService: notifications,
          notificationPollInterval: const Duration(milliseconds: 50),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('1'), findsOneWidget);

    notifications.count = 4;
    await tester.pump(const Duration(milliseconds: 51));
    await tester.pump();

    expect(find.text('4'), findsOneWidget);
    expect(notifications.calls, greaterThanOrEqualTo(2));
  });

  testWidgets('home notification polling pauses while the app is hidden',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final notifications = _UnreadCountService(1);

    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(
          homeDataService: bundle.homeDataService,
          notificationsService: notifications,
          notificationPollInterval: const Duration(milliseconds: 50),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final callsBeforePause = notifications.calls;

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(milliseconds: 100));

    expect(notifications.calls, callsBeforePause);
  });

  testWidgets('home notification polling stops when the home is disposed',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final notifications = _UnreadCountService(1);

    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(
          homeDataService: bundle.homeDataService,
          notificationsService: notifications,
          notificationPollInterval: const Duration(milliseconds: 50),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final callsBeforeDispose = notifications.calls;

    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(milliseconds: 100));

    expect(notifications.calls, callsBeforeDispose);
  });

  testWidgets('home notification polling pauses while its tab is hidden',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final notifications = _UnreadCountService(1);

    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(
          homeDataService: bundle.homeDataService,
          notificationsService: notifications,
          isHomeTabActive: false,
          notificationPollInterval: const Duration(milliseconds: 50),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final callsWhileHidden = notifications.calls;
    await tester.pump(const Duration(milliseconds: 100));

    expect(notifications.calls, callsWhileHidden);
  });
}

class _UnreadCountService extends NotificationsService {
  int count;
  int calls = 0;

  _UnreadCountService(this.count) : super();

  @override
  Future<int> fetchUnreadCount() async {
    calls++;
    return count;
  }
}
