import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/screens/send_money_entry_screen.dart';
import 'package:trustpay_app/features/home/widgets/transfer_widgets.dart';
import 'support/trustpay_test_api.dart';

Finder field(String label) => find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.labelText == label);
const captureSteps = bool.fromEnvironment('SEND_STEPS_CAPTURE');
Future<void> capture(GlobalKey key, String name) async {
  if (!captureSteps) return;
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  final picture = await boundary.toImage(pixelRatio: 1);
  final bytes = await picture.toByteData(format: ui.ImageByteFormat.png);
  final file = File('../output/send-money-steps/$name.png');
  await file.parent.create(recursive: true);
  await file.writeAsBytes(bytes!.buffer.asUint8List());
  picture.dispose();
}

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (captureSteps) {
      await (FontLoader('MaterialIcons')
            ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf')))
          .load();
      await GoogleFonts.pendingFonts([
        AppTextStyles.bodyM,
        AppTextStyles.headingL,
        AppTextStyles.headingXL
      ]);
    }
  });
  setUp(() => setMockSecureStorage());
  for (final size in [
    const Size(430, 932),
    const Size(360, 800),
    const Size(1024, 900)
  ]) {
    testWidgets(
        'destination, amount and recipient stay separate at ${size.width}px',
        (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final bundle = buildTrustPayTestBundle();
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(
          key: key,
          child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: size.width == 360 ? AppTheme.dark : AppTheme.light,
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context).copyWith(
                      textScaler:
                          TextScaler.linear(size.width == 360 ? 1.8 : 1)),
                  child: child!),
              home: SendMoneyEntryScreen(apiClient: bundle.apiClient))));
      await tester.pumpAndSettle();
      expect(find.byType(TextField), findsNothing);
      expect(tester.takeException(), isNull);
      await tester
          .runAsync(() => capture(key, 'destination-${size.width.toInt()}'));
      await tester.ensureVisible(find.text('TrustPay'));
      await tester.tap(find.text('TrustPay'));
      await tester.pumpAndSettle();
      expect(field('Amount'), findsOneWidget);
      expect(field('TrustPay account number or email'), findsNothing);
      expect(find.text('Available ₦125,000.50'), findsOneWidget);
      await tester.enterText(field('Amount'), '20');
      await tester.pumpAndSettle();
      tester.testTextInput.hide();
      await tester.pumpAndSettle();
      await tester.runAsync(() => capture(key, 'amount-${size.width.toInt()}'));
      await tester.tap(find.text('Continue to recipient'));
      await tester.pumpAndSettle();
      expect(field('Amount'), findsNothing);
      expect(field('TrustPay account number or email'), findsOneWidget);
      await tester.enterText(
          field('TrustPay account number or email'), 'tolu@example.com');
      await tester.pump(const Duration(milliseconds: 700));
      await tester.pumpAndSettle();
      expect(find.text('Recipient confirmed'), findsOneWidget);
      tester.testTextInput.hide();
      await tester.pumpAndSettle();
      await tester
          .runAsync(() => capture(key, 'recipient-${size.width.toInt()}'));
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(field('Amount')).controller!.text, '20');
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Where are you sending money?'), findsOneWidget);
      expect(bundle.adapter.internalTransferMutationCount, 0);
      expect(tester.takeException(), isNull);
    });
  }
  for (final state in ['disabled', 'failed', 'loading', 'large-text']) {
    testWidgets('bank availability $state has clear reachable actions',
        (tester) async {
      final large = state == 'large-text';
      tester.view.physicalSize = Size(large ? 360 : 430, large ? 800 : 932);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final key = GlobalKey();
      final loading = state == 'loading';
      final failed = state == 'failed';
      await tester.pumpWidget(RepaintBoundary(
          key: key,
          child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: large ? AppTheme.dark : AppTheme.light,
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(large ? 2 : 1)),
                  child: child!),
              home: TransferAvailabilityView(
                  bank: true,
                  loading: loading,
                  failed: failed,
                  title: loading
                      ? 'Checking transfer availability'
                      : failed
                          ? 'Couldn’t load bank transfers'
                          : 'Bank transfers are unavailable',
                  message: loading
                      ? 'This will only take a moment.'
                      : failed
                          ? 'Check your connection and try again.'
                          : 'This service isn’t available right now. Contact TrustPay support for help.',
                  onBack: () {},
                  onRetry: () {},
                  onSupport: () {}))));
      if (loading) {
        await tester.pump(const Duration(milliseconds: 100));
      } else {
        await tester.pumpAndSettle();
      }
      expect(tester.takeException(), isNull);
      expect(tester.widget<Text>(find.text('Bank transfer')).style?.color,
          AppColors.textPrimary);
      expect(field('Amount'), findsNothing);
      expect(find.text('Retry'), failed ? findsOneWidget : findsNothing);
      expect(find.text('Contact support'),
          !loading && !failed ? findsOneWidget : findsNothing);
      if (!loading) {
        await tester.ensureVisible(find.text('Go back'));
      }
      await tester.runAsync(() => capture(key, 'bank-$state'));
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
