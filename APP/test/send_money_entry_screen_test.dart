import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/home/screens/send_money_entry_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  testWidgets('send entry opens the transfer form directly', (tester) async {
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(
      MaterialApp(home: SendMoneyEntryScreen(apiClient: bundle.apiClient)),
    );
    await tester.pumpAndSettle();

    expect(
        find.text('Send to another TrustPay user by email.'), findsOneWidget);
    expect(
      find.text('Pick a TrustPay user or send to a bank account.'),
      findsNothing,
    );
    expect(find.text('TrustPay users'), findsNothing);
    expect(find.text('Other banks'), findsNothing);
  });
}
