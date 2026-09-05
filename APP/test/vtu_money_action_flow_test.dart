import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  Future<TrustPayTestBundle> render(
    WidgetTester tester,
    MoneyActionKind kind, {
    bool includeVtuProviders = false,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle(
      includeVtuProviders: includeVtuProviders,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: MoneyActionScreen(kind: kind, apiClient: bundle.apiClient),
      ),
    );
    await tester.pump();
    for (var attempt = 0; attempt < 40; attempt++) {
      await tester.pump(const Duration(milliseconds: 50));
      final loadedProviderCatalogs = bundle.adapter.requestedUris
          .where((uri) => uri.path == '/api/vtu/providers')
          .length;
      if (loadedProviderCatalogs >= 4) break;
    }
    return bundle;
  }

  testWidgets('airtime collects recipient details before the amount', (
    tester,
  ) async {
    await render(
      tester,
      MoneyActionKind.airtime,
      includeVtuProviders: true,
    );

    expect(find.text('Continue to amount'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.labelText == 'Amount',
      ),
      findsNothing,
    );

    final phoneField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField && widget.decoration?.labelText == 'Phone number',
    );
    await tester.enterText(phoneField, '08012345678');
    await tester.tap(find.text('Continue to amount'));
    await tester.pump();

    expect(find.text('Top-up recipient'), findsOneWidget);
    expect(find.text('Continue to amount'), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.labelText == 'Amount',
      ),
      findsOneWidget,
    );
  });

  testWidgets('bank transfer collects the amount before bank details', (
    tester,
  ) async {
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(
      MaterialApp(
        home: MoneyActionScreen(
          kind: MoneyActionKind.withdraw,
          apiClient: bundle.apiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Step 1 of 2 · Choose the payout currency and amount.'),
        findsOneWidget);
    expect(find.text('Continue to bank details'), findsOneWidget);
    expect(find.text('Bank code'), findsNothing);
    expect(find.text('Account number'), findsNothing);

    final amountField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField && widget.decoration?.labelText == 'Amount',
    );
    await tester.enterText(amountField, '1000');
    await tester.tap(find.text('Continue to bank details'));
    await tester.pumpAndSettle();

    expect(find.text('Step 2 of 2 · Enter the bank details.'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            (widget.decoration?.labelText == 'Bank' ||
                widget.decoration?.labelText == 'Bank code'),
      ),
      findsOneWidget,
    );
    expect(find.text('Account number'), findsOneWidget);
    expect(find.text('Send transfer'), findsOneWidget);
    expect(find.text('Continue to bank details'), findsNothing);
  });

  testWidgets('non-NGN bank payouts route through exchange first',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(
      MaterialApp(
        home: MoneyActionScreen(
          kind: MoneyActionKind.withdraw,
          apiClient: bundle.apiClient,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final currencyField = find.byType(DropdownButtonFormField<String>);
    await tester.tap(currencyField);
    await tester.pumpAndSettle();
    await tester.tap(find.text('GHS').last);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.labelText == 'Amount',
      ),
      '1000',
    );
    await tester.tap(find.text('Continue to bank details'));
    await tester.pumpAndSettle();

    expect(
      find.text('Exchange GHS to NGN before sending to a bank account.'),
      findsOneWidget,
    );
    expect(find.text('Step 2 of 2 · Enter the bank details.'), findsNothing);
  });

  testWidgets('cable TV stages provider selection before card details', (
    tester,
  ) async {
    await render(
      tester,
      MoneyActionKind.cable,
      includeVtuProviders: true,
    );

    expect(find.text('Continue to card details'), findsOneWidget);
    expect(find.text('Smart card / IUC number'), findsNothing);
    await tester.tap(find.text('Continue to card details'));
    await tester.pump();

    expect(find.text('Card details'), findsOneWidget);
    expect(find.text('Smart card / IUC number'), findsOneWidget);
    expect(find.text('Contact phone number'), findsOneWidget);
    expect(find.text('Verify card & continue'), findsOneWidget);
    expect(find.text('Continue to card details'), findsNothing);
  });

  testWidgets('international airtime is coming soon and makes no legacy call', (
    tester,
  ) async {
    final bundle = await render(tester, MoneyActionKind.airtime);

    await tester.tap(find.text('Nigeria').first);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('International').last);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Ghana (coming soon)'), findsOneWidget);
    final providerRequests = bundle.adapter.requestedUris.where(
      (uri) => uri.path == '/api/vtu/providers',
    );
    expect(providerRequests, isNotEmpty);
    for (final request in providerRequests) {
      expect(request.queryParameters.keys, unorderedEquals(['type']));
    }
  });

  testWidgets('non-Nigerian data markets are disabled as coming soon', (
    tester,
  ) async {
    await render(tester, MoneyActionKind.data);

    await tester.tap(find.text('Nigeria').first);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Ghana (coming soon)'), findsOneWidget);
    expect(find.text('Kenya (coming soon)'), findsOneWidget);
    expect(find.text('South Africa (coming soon)'), findsOneWidget);
    expect(find.text('United States (coming soon)'), findsOneWidget);
    expect(find.text('United Kingdom (coming soon)'), findsOneWidget);
  });

  testWidgets('non-Nigerian electricity markets are disabled as coming soon', (
    tester,
  ) async {
    await render(tester, MoneyActionKind.electricity);

    await tester.tap(find.text('Nigeria').first);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Ghana (coming soon)'), findsOneWidget);
    expect(find.text('Kenya (coming soon)'), findsOneWidget);
    expect(find.text('South Africa (coming soon)'), findsOneWidget);
  });
}
