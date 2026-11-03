import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/widgets/payment_review_sheet.dart';

void main() {
  for (final width in [360.0, 430.0]) {
    testWidgets('review sheet scrolls at ${width}px and 2x text; edit cancels',
        (tester) async {
      tester.view.physicalSize = Size(width, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      bool? result;
      await tester.pumpWidget(MaterialApp(
          home: MediaQuery(
              data: MediaQueryData(
                  size: Size(width, 600),
                  textScaler: const TextScaler.linear(2)),
              child: Builder(
                  builder: (context) => Scaffold(
                      body: TextButton(
                          onPressed: () async {
                            result = await showPaymentReviewSheet(context,
                                title: 'Review airtime',
                                amountLabel: '₦50.00',
                                entries: const [
                                  PaymentReviewEntry('Phone', '08106549123'),
                                  PaymentReviewEntry('Network', 'MTN')
                                ]);
                          },
                          child: const Text('Open')))))));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
      final button = find.widgetWithText(FilledButton, 'Continue');
      await tester.ensureVisible(button);
      expect(tester.getSize(button).height, greaterThanOrEqualTo(56));
      final edit = find.text('Edit');
      await tester.ensureVisible(edit);
      await tester.tap(edit);
      await tester.pumpAndSettle();
      expect(result, false);
    });
  }
}
