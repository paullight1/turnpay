import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';

import 'support/trustpay_test_api.dart';

void main() {
  Future<TrustPayTestBundle> render(
    WidgetTester tester,
    MoneyActionKind kind,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    setMockSecureStorage();
    final bundle = buildTrustPayTestBundle();
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
