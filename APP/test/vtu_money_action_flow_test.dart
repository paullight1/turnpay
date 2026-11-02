import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
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
    await tester.enterText(phoneField, '08031234567');
    await tester.pump();
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

  testWidgets('airtime suggests a network and keeps a manual ported override',
      (tester) async {
    await render(tester, MoneyActionKind.airtime, includeVtuProviders: true);
    final phone = find.byWidgetPredicate((widget) =>
        widget is TextField && widget.decoration?.labelText == 'Phone number');
    await tester.enterText(phone, '+234 802 123 4567');
    await tester.pumpAndSettle();
    expect(find.text('Airtel suggested from number'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('MTN network'));
    await tester.pumpAndSettle();
    expect(find.text('MTN selected manually'), findsOneWidget);
    await tester.enterText(phone, '+234 802 123 4568');
    await tester.pumpAndSettle();
    expect(find.text('Airtel suggested from number'), findsOneWidget);
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    expect(find.text('08021234568'), findsOneWidget);
    expect(find.text('Airtel'), findsOneWidget);
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

    expect(
        find.text('Step 1 of 2 · Choose an amount to send.'), findsOneWidget);
    expect(find.text('Continue to bank details'), findsOneWidget);
    expect(find.text('Bank code'), findsNothing);
    expect(find.text('Account number'), findsNothing);

    final amountField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField && widget.decoration?.labelText == 'Amount',
    );
    await tester.enterText(amountField, '1000');
    await tester.pump();
    await tester.tap(find.text('Continue to bank details'));
    await tester.pumpAndSettle();

    expect(find.text('Step 2 of 2 · Enter the bank details.'), findsOneWidget);
    expect(find.text('Choose bank'), findsOneWidget);
    expect(find.text('Account number'), findsOneWidget);
    expect(find.text('Review transfer'), findsOneWidget);
    expect(find.text('Continue to bank details'), findsNothing);
  });

  testWidgets(
      'unavailable country selection preserves a ported number network override',
      (tester) async {
    await render(tester, MoneyActionKind.airtime, includeVtuProviders: true);
    final phone = find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Phone number');
    await tester.enterText(phone, '08031234567');
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Airtel network'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Service country').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ghana (coming soon)'));
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('Airtel selected manually'), findsOneWidget);
    await tester.tap(find.text('Continue to amount'));
    await tester.pumpAndSettle();
    expect(find.text('Airtel'), findsOneWidget);
  });

  testWidgets('bank payouts expose only the supported NGN wallet',
      (tester) async {
    final bundle = buildTrustPayTestBundle();
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.withdraw, apiClient: bundle.apiClient)));
    await tester.pumpAndSettle();
    expect(find.text('NGN wallet'), findsOneWidget);
    expect(find.text('GHS wallet'), findsNothing);
    await tester.enterText(
        find.byWidgetPredicate(
            (w) => w is TextField && w.decoration?.labelText == 'Amount'),
        '1000');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to bank details'));
    await tester.pumpAndSettle();
    expect(find.text('Step 2 of 2 · Enter the bank details.'), findsOneWidget);
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
    expect(find.text('Renew current package'), findsNothing);
    expect(find.text('Smart card / IUC number'), findsNothing);
    await tester.tap(find.text('Continue to card details'));
    await tester.pump();

    expect(find.text('Card details'), findsOneWidget);
    expect(find.text('Smart card / IUC number'), findsOneWidget);
    expect(find.text('Contact phone number'), findsOneWidget);
    expect(find.text('Verify card & continue'), findsOneWidget);
    expect(find.text('Continue to card details'), findsNothing);
  });

  testWidgets(
      'international airtime opens the VTpass destination form when the expanded catalog supports it',
      (tester) async {
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle();
    bundle.apiClient.client.interceptors
        .add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.path == '/api/vtu/providers') {
        handler.resolve(Response(
            requestOptions: options,
            data: options.queryParameters['type'] == 'airtime'
                ? [
                    {
                      'id': 'mtn',
                      'name': 'MTN',
                      'type': 'airtime',
                      'isActive': true
                    },
                    {
                      'id': 'foreign-airtime',
                      'name': 'International Airtime',
                      'type': 'airtime',
                      'isActive': true
                    },
                  ]
                : []));
      } else if (options.path == '/api/vtu/international/countries') {
        handler.resolve(Response(requestOptions: options, data: [
          {'code': 'GH', 'name': 'Ghana', 'prefix': '233'}
        ]));
      } else {
        handler.next(options);
      }
    }));
    await tester.pumpWidget(MaterialApp(
        home: MoneyActionScreen(
            kind: MoneyActionKind.airtime, apiClient: bundle.apiClient)));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Service country').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('International').last);
    await tester.pumpAndSettle();
    expect(find.byTooltip('Service country'), findsOneWidget);
    expect(find.text('Ghana (coming soon)'), findsNothing);
  });

  testWidgets('international airtime is coming soon and makes no legacy call', (
    tester,
  ) async {
    final bundle = await render(tester, MoneyActionKind.airtime);

    await tester.tap(find.byTooltip('Service country').first);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Ghana (coming soon)'), findsOneWidget);
    expect(
        tester
            .widget<PopupMenuItem<String>>(find.ancestor(
                of: find.text('Ghana (coming soon)'),
                matching: find.byType(PopupMenuItem<String>)))
            .enabled,
        isFalse);
    final providerRequests = bundle.adapter.requestedUris.where(
      (uri) => uri.path == '/api/vtu/providers',
    );
    expect(providerRequests, isNotEmpty);
    for (final request in providerRequests) {
      expect(
          request.queryParameters.keys, unorderedEquals(['type', 'catalog']));
      expect(request.queryParameters['catalog'], 'extended');
    }
  });

  testWidgets('non-Nigerian data markets are disabled as coming soon', (
    tester,
  ) async {
    await render(tester, MoneyActionKind.data);

    await tester.tap(find.byTooltip('Service country').first);
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

    await tester.tap(find.byTooltip('Service country').first);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Ghana (coming soon)'), findsOneWidget);
    expect(find.text('Kenya (coming soon)'), findsOneWidget);
    expect(find.text('South Africa (coming soon)'), findsOneWidget);
  });
}
