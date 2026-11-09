import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/features/home/screens/home_screen.dart';
import 'support/trustpay_test_api.dart';

void main() {
  test('all transaction types open their own receipt with encoded reference',
      () {
    for (final type in ['AIRTIME', 'DATA', 'CABLE', 'ELECTRICITY']) {
      expect(AppRoutes.receiptFor(type, 'TX/1'), '/vtu/order/TX%2F1');
    }
    expect(AppRoutes.receiptFor('FUND', 'DEP/1'), '/transaction/DEP%2F1');
    expect(AppRoutes.receiptFor('EXCHANGE', 'EX/1'), '/transaction/EX%2F1');
    expect(AppRoutes.receiptFor('INTERNAL_TRANSFER', 'IT/1'),
        AppRoutes.sendReceiptFor('IT/1'));
    expect(AppRoutes.receiptFor('WITHDRAW', 'WT/1'),
        AppRoutes.withdrawReceiptFor('WT/1'));
  });

  testWidgets('tapping a recent deposit opens its receipt directly',
      (tester) async {
    setMockSecureStorage(refreshToken: 'refresh-token');
    final bundle = buildTrustPayTestBundle();
    final router = GoRouter(initialLocation: AppRoutes.home, routes: [
      GoRoute(
          path: AppRoutes.home,
          builder: (_, __) =>
              HomeScreen(homeDataService: bundle.homeDataService)),
      GoRoute(
          path: AppRoutes.transactionDetail,
          builder: (_, state) => Scaffold(
              body: Text('Receipt ${state.pathParameters['reference']}'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Fund success'), 250,
        scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Fund success'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fund success'));
    await tester.pumpAndSettle();
    expect(find.text('Receipt DEP-001'), findsOneWidget);
  });
}
