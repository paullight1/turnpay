import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/wallet/screens/receive_money_screen.dart';
import 'support/trustpay_test_api.dart';

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (!const bool.fromEnvironment('WALLET_CAPTURE')) return;
    final icons = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await icons.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await icons.readAsBytes()))))
          .load();
    }
  });
  for (final variant in [
    (name: 'mobile', size: const Size(430, 932), dark: false, scale: 1.0),
    (
      name: 'small-large-text',
      size: const Size(320, 640),
      dark: true,
      scale: 1.5
    ),
    (name: 'desktop', size: const Size(1024, 768), dark: false, scale: 1.0),
  ]) {
    testWidgets('receiving setup stays reachable on ${variant.name}',
        (tester) async {
      setMockSecureStorage(refreshToken: 'refresh-token');
      tester.view.physicalSize = variant.size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final bundle = buildTrustPayTestBundle(
          includeVirtualAccounts: false, kycStatus: 'PENDING');
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(
          key: key,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: variant.dark ? AppTheme.dark : AppTheme.light,
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(variant.scale)),
                child: child!),
            home: ReceiveMoneyScreen(
                walletService: bundle.walletService,
                homeDataService: bundle.homeDataService),
          )));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Create TrustPay account'));
      await tester.pumpAndSettle();
      expect(
          tester
              .getSize(
                  find.widgetWithText(FilledButton, 'Create TrustPay account'))
              .height,
          greaterThanOrEqualTo(56));
      if (const bool.fromEnvironment('WALLET_CAPTURE')) {
        await tester.runAsync(() async {
          final boundary =
              key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          final image = await boundary.toImage(pixelRatio: 2);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File('../output/wallet-ux/receive-${variant.name}.png');
          await file.parent.create(recursive: true);
          await file.writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
      await tester.tap(find.text('Create TrustPay account'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Request receiving account'));
      expect(tester.takeException(), isNull);
      expect(find.text('Verify identity'), findsOneWidget);
    });
  }
}
