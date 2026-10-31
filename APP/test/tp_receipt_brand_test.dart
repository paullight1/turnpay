import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/core/widgets/tp_receipt.dart';

void main() {
  testWidgets('long pending status fits a narrow receipt at large text size',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(1.5)),
        child: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 320,
              child: TpReceiptCard(
                tone: TpReceiptTone.pending,
                headerTitle: 'Electricity receipt',
                headerSubtitle: 'TrustPay',
                statusLabel: 'Awaiting confirmation',
                entries: [TpReceiptEntry('Reference', 'SANDBOX-TEST')],
                footerNote: 'Test receipt',
              ),
            ),
          ),
        ),
      ),
    ));
    expect(find.text('AWAITING CONFIRMATION'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  for (final tone in TpReceiptTone.values) {
    testWidgets('receipt preserves branding and data for ${tone.name}',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(
              body: TpReceiptCard(
        tone: tone,
        headerTitle: 'Airtime receipt',
        headerSubtitle: 'TrustPay',
        statusLabel: tone.name,
        entries: const [TpReceiptEntry('Reference', 'SANDBOX-TEST')],
        footerNote: 'Test receipt',
      ))));
      expect(find.bySemanticsLabel('TrustPay logo'), findsOneWidget);
      expect(find.text(tone.name.toUpperCase()), findsOneWidget);
      expect(find.text('SANDBOX-TEST'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
