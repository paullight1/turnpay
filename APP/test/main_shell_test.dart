import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/widgets/main_shell.dart';
import 'package:trustpay_app/core/state/wallet_refresh_signal.dart';

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
      ProviderScope(
        child: MaterialApp(
          home: MainShell(homeDataService: bundle.homeDataService),
        ),
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
    expect(find.text('My Transactions'), findsWidgets);
    expect(
      bundle.adapter.requestedUris
          .where((uri) => uri.path == '/api/auth/bootstrap')
          .length,
      1,
      reason:
          'History should load transactions without reloading the dashboard',
    );

    await tester.tap(find.text('Home').last);
    await tester.pumpAndSettle();
    expect(find.text('Top services'), findsOneWidget);
    expect(
      bundle.adapter.requestedUris
          .where((uri) => uri.path == '/api/auth/bootstrap')
          .length,
      1,
      reason: 'Returning Home should preserve its loaded dashboard',
    );

    walletRefreshSignal.bump();
    await tester.pumpAndSettle();
    expect(
      bundle.adapter.requestedUris
          .where((uri) => uri.path == '/api/auth/bootstrap')
          .length,
      2,
      reason: 'Money movement must still refresh balances on the retained Home',
    );

    final beforeProfile = bundle.adapter.requestedUris.length;
    await tester.tap(find.text('Profile').last);
    await tester.pumpAndSettle();

    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Account Details'), findsWidgets);
    expect(
      bundle.adapter.requestedUris.skip(beforeProfile).map((uri) => uri.path),
      ['/api/auth/bootstrap'],
      reason: 'Profile only needs the current user',
    );
    await tester.scrollUntilVisible(
      find.text('Help & Support'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Help & Support'), findsWidgets);
  });
}
