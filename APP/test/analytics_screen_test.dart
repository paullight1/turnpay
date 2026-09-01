import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/features/analytics/screens/analytics_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('analytics screen renders and switches between tabs',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: AnalyticsScreen(),
      ),
    );

    await tester.pump();

    expect(find.text('History'), findsOneWidget);
    expect(find.text('Income'), findsOneWidget);
    expect(find.text('Outcome'), findsOneWidget);
    expect(find.text('Spend Breakdown'), findsOneWidget);
    expect(find.text('My Income'), findsOneWidget);

    await tester.tap(find.text('Outcome'));
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('My Spending'), findsOneWidget);
  });
}
