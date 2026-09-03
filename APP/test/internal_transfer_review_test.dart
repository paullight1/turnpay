import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
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

    final fields =
        tester.widgetList<TextField>(find.byType(TextField)).toList();
    final amount = fields.singleWhere(
      (field) => field.decoration?.labelText == 'Amount',
    );
    final recipient = fields.singleWhere(
      (field) => field.decoration?.labelText == 'Recipient email',
    );
    final note = fields.singleWhere(
      (field) => field.decoration?.labelText == 'Note optional',
    );

    amount.focusNode!.requestFocus();
    await tester.pump();
    expect(amount.focusNode!.hasFocus, isTrue);

    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pump();
    expect(recipient.focusNode!.hasFocus, isTrue);

    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pump();
    expect(note.focusNode!.hasFocus, isTrue);

    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(note.focusNode!.hasFocus, isFalse);
  });
}
