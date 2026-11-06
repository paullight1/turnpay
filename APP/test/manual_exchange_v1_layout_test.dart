import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/exchange/screens/manual_exchange_order_screen.dart';
import 'package:trustpay_app/features/exchange/services/manual_exchange_service.dart';
import 'manual_exchange_v1_ux_test.dart' show fixtureV1Order;

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (!const bool.fromEnvironment('V1_EXCHANGE_CAPTURE')) return;
    final font = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await font.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await font.readAsBytes()))))
          .load();
    }
  });
  for (final variant in [
    (name: 'light', size: const Size(430, 932), dark: false, scale: 1.0),
    (name: 'dark', size: const Size(430, 932), dark: true, scale: 1.0),
    (
      name: 'small-large-text',
      size: const Size(320, 640),
      dark: true,
      scale: 1.6
    ),
  ]) {
    for (final stage in ['transfer', 'receipt', 'review']) {
      testWidgets('$stage is usable on ${variant.name}', (tester) async {
        tester.view.physicalSize = variant.size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final key = GlobalKey();
        final service = _LayoutService(stage);
        await tester.pumpWidget(RepaintBoundary(
            key: key,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: variant.dark ? AppTheme.dark : AppTheme.light,
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(variant.scale)),
                  child: child!),
              home: ManualExchangeOrderScreen(
                  orderId: 'original-order', service: service),
            )));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        if (const bool.fromEnvironment('V1_EXCHANGE_CAPTURE')) {
          await tester.runAsync(() async {
            final image = await (key.currentContext!.findRenderObject()!
                    as RenderRepaintBoundary)
                .toImage(pixelRatio: 2);
            final bytes =
                await image.toByteData(format: ui.ImageByteFormat.png);
            final file =
                File('../output/v1-exchange-ui/$stage-${variant.name}.png');
            await file.parent.create(recursive: true);
            await file.writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
        final label = switch (stage) {
          'transfer' => 'I’ve made this transfer',
          'receipt' => 'Confirm payment & submit receipt',
          _ => 'Refresh review status'
        };
        await tester.scrollUntilVisible(find.text(label), 220,
            scrollable: find.byType(Scrollable).first);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(
            tester
                .getSize(find
                    .ancestor(
                        of: find.text(label),
                        matching: find.bySubtype<ButtonStyleButton>())
                    .first)
                .height,
            greaterThanOrEqualTo(56));
        if (stage == 'review') {
          expect(find.text('Transfer to this account'), findsNothing);
        }
        await tester.pumpWidget(const SizedBox());
      });
    }
  }
}

class _LayoutService extends ManualExchangeService {
  final String stage;
  _LayoutService(this.stage);
  @override
  Future<ManualExchangeOrder> getOrder(String id) async => fixtureV1Order(
      status: stage == 'review' ? 'AWAITING_CONFIRMATION' : 'AWAITING_TRANSFER',
      hasProof: stage == 'review');
  @override
  Future<bool> receiptStepStarted(String id) async => stage == 'receipt';
}
