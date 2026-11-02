import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/exchange/screens/exchange_converter.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';

class _MissingRate extends ManualExchangeService {
  @override
  Future<Map<String, dynamic>> previewRate(String source) async => {
        'configured': false,
        'effectiveRate': null,
        'isStale': true,
      };
}

class _Rates extends ManualExchangeService {
  String rate = '0.02';
  bool stale = false;
  @override
  Future<Map<String, dynamic>> previewRate(String source) async =>
      {'effectiveRate': rate, 'isStale': stale};
}

class _RecoveringRates extends ManualExchangeService {
  bool ready = false;
  @override
  Future<Map<String, dynamic>> previewRate(String source) async => ready
      ? {'effectiveRate': '0.02', 'isStale': false}
      : {'configured': false, 'effectiveRate': null, 'isStale': true};
}

void main() {
  test('preview uses exact arithmetic and reverse entry rounds up', () {
    expect(convertExchangePreview('1000', '0.02'), '20.00');
    expect(convertExchangePreview('20', '0.02', inverse: true), '1000.00');
    expect(convertExchangePreview('1', '0.03', inverse: true), '33.34');
    expect(() => convertExchangePreview('1', '0'), throwsFormatException);
  });
  testWidgets('explains an unset admin rate without showing a fallback price',
      (tester) async {
    final amount = TextEditingController();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ExchangeConverter(
      source: 'GHS',
      amount: amount,
      service: _MissingRate(),
      onSwap: null,
      enabled: true,
    ))));
    await tester.pumpAndSettle();
    expect(find.text('This exchange rate is not set yet.'), findsOneWidget);
    expect(find.textContaining('1 GHS ='), findsNothing);
    expect(
        tester.widget<TextFormField>(find.byType(TextFormField).last).enabled,
        isFalse);
    await tester.pumpWidget(const SizedBox());
    amount.dispose();
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
    expect(find.textContaining('1 NGN ='), findsNothing);
    expect(find.text('Check rate'), findsNothing);
    await tester.enterText(find.byType(TextFormField).first, '1000');
    expect(find.text('20.00'), findsOneWidget);
    await tester.pump();
    expect(find.text('One thousand naira'), findsOneWidget);
    expect(find.text('Twenty cedis'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).last, '10');
    expect(amount.text, '500.00');
    await tester.pumpWidget(const SizedBox());
    amount.dispose();
  });

  testWidgets(
      'editing automatically recovers a newly saved rate and preserves the draft',
      (tester) async {
    final amount = TextEditingController(text: '1000');
    final service = _RecoveringRates();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ExchangeConverter(
      source: 'NGN',
      amount: amount,
      service: service,
      onSwap: null,
      enabled: true,
    ))));
    await tester.pumpAndSettle();
    service.ready = true;
    await tester.enterText(find.byType(TextFormField).first, '1001');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(amount.text, '1,001');
    expect(find.text('20.02'), findsOneWidget);
    expect(find.text('This exchange rate is not set yet.'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    amount.dispose();
  });
  testWidgets('automatic refresh preserves the receive amount being edited',
      (tester) async {
    final amount = TextEditingController(text: '1000');
    final service = _Rates()..stale = true;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ExchangeConverter(
                source: 'NGN',
                amount: amount,
                service: service,
                onSwap: null,
                enabled: true))));
    await tester.pumpAndSettle();
    service.rate = '0.04';
    await tester.enterText(find.byType(TextFormField).last, '10');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(amount.text, '250.00');
    expect(find.text('10'), findsOneWidget);
    expect(find.text('Ten cedis'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    amount.dispose();
  });
}
