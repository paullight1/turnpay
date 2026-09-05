import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/exchange/screens/exchange_converter.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';

class _Rates extends ManualExchangeService {
  @override
  Future<Map<String, dynamic>> previewRate(String source) async =>
      {'effectiveRate': '0.02', 'isStale': false};
}

void main() {
  test('preview uses exact arithmetic and reverse entry rounds up', () {
    expect(convertExchangePreview('1000', '0.02'), '20.00');
    expect(convertExchangePreview('20', '0.02', inverse: true), '1000.00');
    expect(convertExchangePreview('1', '0.03', inverse: true), '33.34');
    expect(() => convertExchangePreview('1', '0'), throwsFormatException);
  });
  testWidgets('editing either amount updates the other using displayed rate',
      (tester) async {
    final amount = TextEditingController();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ExchangeConverter(
      source: 'NGN',
      amount: amount,
      service: _Rates(),
      onSwap: () {},
      enabled: true,
    ))));
    await tester.pumpAndSettle();
    expect(find.text('1 NGN = 0.020000 GHS'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).first, '1000');
    expect(find.text('20.00'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).last, '10');
    expect(amount.text, '500.00');
    await tester.pumpWidget(const SizedBox());
    amount.dispose();
  });
}
