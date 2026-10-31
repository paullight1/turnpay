import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/exchange/screens/kora_exchange_screen.dart';
import 'package:trustpay_app/services/kora_service.dart';
import 'kora_service_test.dart' show quoteFixture, orderFixture;

class _Service extends KoraService {
  int creates = 0;
  @override
  Future<Map<String, dynamic>?> pendingMutation(String action) async => null;
  @override
  Future<Map<String, dynamic>> config() async => {
        'enabled': true,
        'ghanaEnabled': true,
        'ghana': {'momoPayouts': true, 'momoCollections': true}
      };
  @override
  Future<Map<String, String>> balances() async =>
      {'GHS': '1000.00', 'NGN': '1000.00'};
  @override
  Future<List<Map<String, dynamic>>> banks() async => [
        {'code': '058', 'name': 'Test Bank'}
      ];
  @override
  Future<List<Map<String, dynamic>>> operators() async => [
        {'slug': 'mtn-gh', 'name': 'MTN Ghana'}
      ];
  @override
  Future<List<KoraOrder>> orders() async => [];
  @override
  Future<Map<String, dynamic>?> pendingAttempt() async => null;
  @override
  Future<KoraQuote> quote(
          {required String source,
          required String funding,
          required String amount,
          required String code,
          required String number}) async =>
      KoraQuote.fromJson(quoteFixture());
  @override
  Future<KoraOrder> createOrder(KoraQuote quote, String pin) async {
    creates++;
    return KoraOrder.fromJson(orderFixture());
  }
}

void main() {
  testWidgets(
      'prioritizes cedi-to-naira and shows confirmed funding without calling it sent',
      (tester) async {
    final service = _Service();
    await tester.pumpWidget(MaterialApp(
        home: KoraExchangeScreen(
            service: service, authorize: (_) async => '2468')));
    await tester.pumpAndSettle();
    expect(find.text('Cedis to naira'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('exchange-amount')), '10');
    await tester.ensureVisible(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('exchange-bank')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Test Bank').last);
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const Key('exchange-recipient')), '0123456789');
    await tester.ensureVisible(find.text('Review exchange'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review exchange'));
    await tester.pumpAndSettle();
    expect(find.text('Verified Receiver'), findsOneWidget);
    expect(find.text('₵10.10'), findsOneWidget);
    await tester.ensureVisible(find.text('Withdraw'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Withdraw'));
    await tester.pumpAndSettle();
    expect(service.creates, 1);
    expect(find.text('Money confirmed'), findsOneWidget);
    expect(find.text('Waiting for admin'), findsOneWidget);
    expect(find.text('Sent'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
}
