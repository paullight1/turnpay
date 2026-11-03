import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/widgets/vtu_purchase_status_view.dart';

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (const bool.fromEnvironment('AIRTIME_CAPTURE')) {
      final icons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await icons.load();
      await GoogleFonts.pendingFonts([
        AppTextStyles.bodyM,
        AppTextStyles.headingL,
        AppTextStyles.headingXL
      ]);
    }
  });
  for (final size in [
    const Size(430, 932),
    const Size(360, 800),
    const Size(1024, 900)
  ]) {
    testWidgets(
        'pending status keeps actions reachable and references collapsed at ${size.width}px',
        (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final capture = GlobalKey();
      var checks = 0;
      await tester.pumpWidget(RepaintBoundary(
          key: capture,
          child: MaterialApp(
              theme: AppTheme.light,
              debugShowCheckedModeBanner: false,
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context).copyWith(
                      textScaler: TextScaler.linear(size.width == 360 ? 2 : 1)),
                  child: child!),
              home: VtuPurchaseStatusView(
                  status: 'UNKNOWN',
                  amount: '50.00',
                  currency: 'NGN',
                  title: 'Airtime top-up',
                  recipient: '+234 *** 23',
                  network: 'MTN',
                  reference: 'VTU-EXAMPLE-REFERENCE',
                  isChecking: false,
                  onCheck: () => checks++,
                  onDone: () {},
                  onSupport: () {},
                  onStartAnother: () {}))));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Confirming your top-up'), findsOneWidget);
      expect(find.text('UNKNOWN'), findsNothing);
      expect(find.text('VTU-EXAMPLE-REFERENCE'), findsNothing);
      expect(find.text('Start another top-up'), findsNothing);
      if (const bool.fromEnvironment('AIRTIME_CAPTURE')) {
        await tester.runAsync(() async {
          final boundary = capture.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
          final picture = await boundary.toImage(pixelRatio: 1);
          final data = await picture.toByteData(format: ui.ImageByteFormat.png);
          final file =
              File('../output/airtime-ux/pending-${size.width.toInt()}.png');
          await file.parent.create(recursive: true);
          await file.writeAsBytes(data!.buffer.asUint8List());
          picture.dispose();
        });
      }
      final button = find.widgetWithText(FilledButton, 'Check status');
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pumpAndSettle();
      expect(checks, 1);
      await tester.ensureVisible(find.text('Payment details'));
      await tester.tap(find.text('Payment details'));
      await tester.pumpAndSettle();
      expect(find.text('VTU-EXAMPLE-REFERENCE'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
