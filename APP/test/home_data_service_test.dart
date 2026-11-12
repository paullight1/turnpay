import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/trustpay_test_api.dart';

void main() {
  test(
      'bootstrap remembers the current user before a slow dashboard collection finishes',
      () async {
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle();
    final transactionsReady = Completer<void>();
    bundle.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.path == '/api/transactions') {
            await transactionsReady.future;
          }
          handler.next(options);
        },
      ),
    );

    final dashboard = bundle.homeDataService.fetchDashboard();
    try {
      for (var attempt = 0;
          attempt < 100 && bundle.homeDataService.lastKnownUser == null;
          attempt++) {
        await Future<void>.delayed(const Duration(milliseconds: 1));
      }
      expect(bundle.homeDataService.lastKnownUser?.id, 'user-1');
    } finally {
      if (!transactionsReady.isCompleted) transactionsReady.complete();
      await dashboard;
    }
  });
}
