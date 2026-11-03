import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/home/screens/send_money_entry_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  testWidgets('send entry asks for the destination before showing any form',
      (tester) async {
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(
      MaterialApp(home: SendMoneyEntryScreen(apiClient: bundle.apiClient)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Where are you sending money?'), findsOneWidget);
    expect(find.text('TrustPay'), findsOneWidget);
    expect(find.text('Bank account'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
  });
}
