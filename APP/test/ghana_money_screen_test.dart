import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/ghana/ghana_money_screen.dart';
import 'package:trustpay_app/services/kora_service.dart';

class _Service extends KoraService {
  bool pending = true;
  int sends = 0;
  @override
  Future<Map<String, dynamic>?> pendingMutation(String action) async => null;
  @override
  Future<Map<String, dynamic>> capabilities() async => {
        'enabled': true,
        'virtualAccounts': true,
        'momoCollections': true,
        'momoPayouts': true
      };
  @override
  Future<Map<String, dynamic>> account() async => pending
      ? {'status': 'PENDING', 'accountNumber': '0000000000'}
      : {
          'status': 'ACTIVE',
          'accountNumber': '1234567890',
          'bankName': 'Ghana Bank',
          'accountName': 'Verified Customer'
        };
  @override
  Future<List<Map<String, dynamic>>> operators() async => [
        {'slug': 'mtn-gh', 'name': 'MTN Ghana'}
      ];
  @override
  Future<Map<String, dynamic>> resolveRecipient(
          String number, String operator) async =>
      {'name': 'Verified Receiver'};
  @override
  Future<Map<String, dynamic>> cashout(
      {required String amount,
      required String number,
      required String operator,
      required String pin,
      String? name}) async {
    expect(amount, '10.01');
    expect(ghanaPhone(number), '233241234567');
    expect(operator, 'mtn-gh');
    expect(pin, '2468');
    expect(name, 'Verified Receiver');
    sends++;
    return {
      'status': 'PENDING',
      'amount': amount,
      'accountName': name,
      'accountNumberMasked': '******4567',
      'reference': 'ghs-out-test'
    };
  }
}

void main() {
  testWidgets('pending Ghana account hides numbers until confirmed active',
      (tester) async {
    final service = _Service();
    await tester
        .pumpWidget(MaterialApp(home: GhanaMoneyScreen(service: service)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bank transfer'));
    await tester.pumpAndSettle();
    expect(find.textContaining('being prepared'), findsOneWidget);
    expect(find.text('0000000000'), findsNothing);
    service.pending = false;
    await tester.tap(find.text('Check account status'));
    await tester.pumpAndSettle();
    expect(find.text('1234567890'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('cash-out resolves recipient then requires PIN and stays pending',
      (tester) async {
    final service = _Service();
    int pins = 0;
    await tester.pumpWidget(MaterialApp(
        home: GhanaMoneyScreen(
            withdraw: true,
            service: service,
            authorize: (_) async {
              pins++;
              return '2468';
            })));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextField, 'Amount in cedis'), '10.01');
    await tester.enterText(
        find.widgetWithText(TextField, 'Receiving MoMo number'), '0241234567');
    await tester.ensureVisible(find.text('MoMo network'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MoMo network'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MTN Ghana').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Review cash-out'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review cash-out'));
    await tester.pumpAndSettle();
    expect(find.text('Verified Receiver'), findsOneWidget);
    expect(pins, 0);
    await tester.tap(find.text('Withdraw'));
    await tester.pumpAndSettle();
    expect(pins, 1);
    expect(service.sends, 1);
    expect(find.text('Checking your cash-out'), findsOneWidget);
    expect(find.text('Sent'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
}
