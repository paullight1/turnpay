import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  setUp(() => setMockSecureStorage());
  test('review contract always presents amount, zero fee, and total debit', () {
    expect(
      InternalTransferReviewContract.financialRows(
        amount: '1250.50',
        currency: 'NGN',
      ),
      const [
        MoneyReviewRow('Amount', '1250.50 NGN'),
        MoneyReviewRow('Fee', '0.00 NGN'),
        MoneyReviewRow('Total debit', '1250.50 NGN'),
      ],
    );
  });

  test('a double tap cannot claim a second submission', () {
    final gate = MoneySubmissionGate();

    expect(gate.tryClaim(), isTrue);
    expect(gate.tryClaim(), isFalse);
    gate.release();
    expect(gate.tryClaim(), isTrue);
  });

  testWidgets('send fields follow amount, recipient, note keyboard order', (
    tester,
  ) async {
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(
      MaterialApp(
        home: MoneyActionScreen(
          kind: MoneyActionKind.send,
          apiClient: bundle.apiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final amount = tester.widget<TextField>(find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Amount'));
    expect(
        find.byWidgetPredicate((w) =>
            w is TextField &&
            w.decoration?.labelText == 'TrustPay account number or email'),
        findsNothing);
    amount.focusNode!.requestFocus();
    await tester.enterText(find.byType(TextField), '20');
    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pumpAndSettle();
    final fields =
        tester.widgetList<TextField>(find.byType(TextField)).toList();
    final recipient = fields.singleWhere(
      (field) =>
          field.decoration?.labelText == 'TrustPay account number or email',
    );
    final note = fields.singleWhere(
      (field) => field.decoration?.labelText == 'Note optional',
    );

    recipient.focusNode!.requestFocus();
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pump();
    expect(note.focusNode!.hasFocus, isTrue);

    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(note.focusNode!.hasFocus, isFalse);
  });
}
