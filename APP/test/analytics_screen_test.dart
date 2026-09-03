import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/analytics/screens/analytics_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets('analytics screen renders and switches between tabs',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp(
        home: AnalyticsScreen(walletService: bundle.walletService),
      ),
    );

    await tester.pump();
    await tester.pump(const Duration(seconds: 2));

    expect(find.text('History'), findsOneWidget);
    expect(find.text('Income'), findsOneWidget);
    expect(find.text('Outcome'), findsOneWidget);
    expect(find.text('Spend Breakdown'), findsOneWidget);
    expect(find.text('My Income'), findsOneWidget);

    await tester.tap(find.text('Outcome'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));

    expect(find.text('My Spending'), findsOneWidget);
  });
}
