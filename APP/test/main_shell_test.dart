import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/widgets/main_shell.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  testWidgets('main shell switches between home, history, and profile tabs',
      (tester) async {
    final bundle = buildTrustPayTestBundle();

    await tester.pumpWidget(
      MaterialApp(
        home: MainShell(homeDataService: bundle.homeDataService),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Home'), findsWidgets);
    expect(find.text('Exchange'), findsOneWidget);
    expect(find.text('History'), findsWidgets);
    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Top services'), findsOneWidget);

    await tester.tap(find.text('History').last);
    await tester.pumpAndSettle();

    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Top services'), findsNothing);
    expect(find.text('Recent transactions'), findsWidgets);

    await tester.tap(find.text('Profile').last);
    await tester.pumpAndSettle();

    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Account Details'), findsWidgets);
    expect(find.text('Help & Support'), findsWidgets);
  });
}
