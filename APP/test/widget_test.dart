import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/router/app_router.dart';
import 'package:trustpay_app/core/widgets/tp_page_header.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/main.dart';

void main() {
  testWidgets('TrustPay app renders', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: TrustPayApp(),
      ),
    );
    await tester.pump(const Duration(seconds: 3));

    expect(find.byType(TrustPayApp), findsOneWidget);
  });

  testWidgets('default appearance follows the phone and headers avoid cutouts',
      (tester) async {
    GoogleFonts.config.allowRuntimeFetching = false;
    FlutterSecureStorage.setMockInitialValues({});
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(430, 932);
    const cutout = FakeViewPadding(top: 44, left: 12, right: 8);
    tester.view.viewPadding = cutout;
    tester.view.padding = cutout;
    final dispatcher = tester.binding.platformDispatcher;
    dispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetViewPadding);
    addTearDown(tester.view.resetPadding);
    addTearDown(dispatcher.clearPlatformBrightnessTestValue);

    final router = GoRouter(routes: [
      GoRoute(
        path: '/',
        builder: (_, __) => const Scaffold(
          body: Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: TpPageHeader(label: 'Exchange', showBackButton: false),
          ),
        ),
      ),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(ProviderScope(
      overrides: [appRouterProvider.overrideWithValue(router)],
      child: const TrustPayApp(),
    ));
    await tester.pumpAndSettle();

    final title = find.text('Exchange');
    expect(Theme.of(tester.element(title)).brightness, Brightness.dark);
    final menu = tester.getRect(find.byTooltip('Menu'));
    expect(menu.top, greaterThanOrEqualTo(44));
    expect(menu.right, lessThanOrEqualTo(422));

    dispatcher.platformBrightnessTestValue = Brightness.light;
    await tester.pumpAndSettle();
    expect(Theme.of(tester.element(title)).brightness, Brightness.light);
  });
}
