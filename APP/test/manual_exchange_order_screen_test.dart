import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/state/wallet_refresh_signal.dart';
import 'package:trustpay_app/features/exchange/screens/manual_exchange_order_screen.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('signals a wallet refresh after the server reports credit',
      (tester) async {
    final order = _order(status: 'CREDITED');
    final before = walletRefreshSignal.tick;

    await tester.pumpWidget(
      MaterialApp(
        home: ManualExchangeOrderScreen(
          orderId: order.id,
          service: _FakeManualExchangeService(order),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Credited to wallet'), findsOneWidget);
    expect(walletRefreshSignal.tick, before + 1);
  });

  testWidgets('does not signal a wallet refresh before server credit',
      (tester) async {
    final order = _order(status: 'AWAITING_CONFIRMATION');
    final before = walletRefreshSignal.tick;

    await tester.pumpWidget(
      MaterialApp(
        home: ManualExchangeOrderScreen(
          orderId: order.id,
          service: _FakeManualExchangeService(order),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Awaiting confirmation'), findsOneWidget);
    expect(walletRefreshSignal.tick, before);
  });
}

class _FakeManualExchangeService extends ManualExchangeService {
  final ManualExchangeOrder order;

  _FakeManualExchangeService(this.order) : super();

  @override
  Future<ManualExchangeOrder> getOrder(String orderId) async => order;
}

ManualExchangeOrder _order({required String status}) {
  return ManualExchangeOrder.fromJson({
    'id': 'order-1',
    'reference': 'EX-001',
    'status': status,
    'settlementMode': 'WALLET',
    'sourceCurrency': 'NGN',
    'targetCurrency': 'GHS',
    'amount': '100.00',
    'targetAmount': '0.75',
    'rate': '0.007500',
    'fee': '0.00',
    'collectionAccount': {
      'bankName': 'TrustPay Bank',
      'accountName': 'TrustPay Collection',
      'accountNumber': '1234567890',
      'currency': 'NGN',
      'version': 'v1',
    },
    'expiresAt': '2026-09-05T12:00:00.000Z',
    'createdAt': '2026-09-05T10:00:00.000Z',
    'updatedAt': '2026-09-05T10:30:00.000Z',
    'reviewReason': null,
    'destinationInstitution': null,
    'destinationAccountMasked': null,
    'destinationName': null,
    'bankReference': null,
    'depositReference': null,
    'payoutReference': null,
    'payoutClaimedBy': null,
    'hasProof': false,
    'hasPayoutProof': false,
    'events': [
      {
        'status': 'AWAITING_TRANSFER',
        'reason': 'Order created',
        'createdAt': '2026-09-05T10:00:00.000Z',
      },
    ],
  });
}
