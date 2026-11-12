import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:trustpay_app/features/home/screens/home_screen.dart';
import 'package:trustpay_app/features/notifications/services/notifications_service.dart';
import 'package:trustpay_app/services/home_data_service.dart';

import 'support/trustpay_test_api.dart';

class _RecoveringDashboard extends HomeDataService {
  _RecoveringDashboard(this.data, this.failure);
  final HomeDashboardData data;
  final DioException failure;
  bool fail = true;

  @override
  Future<HomeDashboardData> fetchDashboard() async {
    if (fail) throw failure;
    return data;
  }
}

class _QuietNotifications extends NotificationsService {
  @override
  Future<int> fetchUnreadCount() async => 0;
}

void main() {
  setUp(() => setMockSecureStorage(refreshToken: 'fixture-refresh'));

  for (final width in [360.0, 1024.0]) {
    testWidgets('home network failure recovers without sign-in at $width',
        (tester) async {
      tester.view.physicalSize = Size(width, 932);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final bundle = buildTrustPayTestBundle();
      final service = _RecoveringDashboard(
        (await tester.runAsync(bundle.homeDataService.fetchDashboard))!,
        DioException(
          requestOptions: RequestOptions(path: '/api/transactions'),
          type: DioExceptionType.connectionError,
          message: 'XMLHttpRequest onError callback was called',
        ),
      );
      final router = GoRouter(routes: [
        GoRoute(
            path: '/',
            builder: (_, __) => HomeScreen(
                  homeDataService: service,
                  notificationsService: _QuietNotifications(),
                )),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('XMLHttpRequest'), findsNothing);
      expect(find.text('Log in'), findsNothing);
      expect(find.text('Retry'), findsOneWidget);
      expect(tester.takeException(), isNull);
      service.fail = false;
      await tester.tap(find.text('Retry'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('Good '), findsOneWidget);
      expect(find.text('Retry'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets('home offers login for an explicitly expired session',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    final request = RequestOptions(path: '/api/auth/bootstrap', method: 'POST');
    final service = _RecoveringDashboard(
        (await tester.runAsync(bundle.homeDataService.fetchDashboard))!,
        DioException(
          requestOptions: request,
          response: Response(requestOptions: request, statusCode: 401),
        ));
    await tester.pumpWidget(MaterialApp(
        home: HomeScreen(
      homeDataService: service,
      notificationsService: _QuietNotifications(),
    )));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Log in'), findsOneWidget);
    expect(find.textContaining('session has expired'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
