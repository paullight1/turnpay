import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:trustpay_app/features/transactions/screens/transaction_detail_screen.dart';
import 'package:trustpay_app/services/wallet_service.dart';

class _HistoryWallets extends WalletService {
  @override
  Future<TransactionDetail?> fetchTransactionDetail(String reference) async =>
      TransactionDetail.fromJson({
        'id': 'tx-1',
        'type': 'INTERNAL_TRANSFER',
        'status': 'FAILED',
        'reference': 'IT-1-OUT',
        'amount': '25.50',
        'fee': '0.00',
        'currency': 'NGN',
        'metadata': {'transferReference': 'IT-1'},
      });
}

void main() {
  testWidgets(
      'transfer history opens its receipt and does not claim a fake retry',
      (tester) async {
    final router = GoRouter(initialLocation: '/transaction/IT-1-OUT', routes: [
      GoRoute(
          path: '/transaction/:reference',
          builder: (_, state) => TransactionDetailScreen(
              reference: state.pathParameters['reference']!,
              walletService: _HistoryWallets())),
      GoRoute(
          path: '/send/receipt/:reference',
          builder: (_, state) => Scaffold(
              body: Text('Receipt ${state.pathParameters['reference']}'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    expect(find.text('Retry Transaction'), findsNothing);
    await tester.ensureVisible(find.text('View transfer receipt'));
    await tester.tap(find.text('View transfer receipt'));
    await tester.pumpAndSettle();
    expect(find.text('Receipt IT-1'), findsOneWidget);
  });
}
