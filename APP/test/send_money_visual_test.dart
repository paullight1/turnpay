import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';
import 'package:trustpay_app/services/transaction_security_service.dart';
import 'support/trustpay_test_api.dart';

Future<void> openTransferRecipient(WidgetTester tester) async {
  await tester.pump();
  final next = find.text('Continue to recipient');
  if (next.evaluate().isEmpty) return;
  final amount = find.byWidgetPredicate(
      (w) => w is TextField && w.decoration?.labelText == 'Amount');
  if (tester.widget<TextField>(amount).controller!.text.isEmpty) {
    await tester.enterText(amount, '20');
    await tester.pump();
  }
  await tester.tap(next);
  await tester.pumpAndSettle();
}

class _Security extends TransactionSecurityService {
  @override
  Future<TransactionSecurityConfig> getConfig() async =>
      const TransactionSecurityConfig(
          hasPin: true,
          pinLength: 4,
          biometricEnabled: false,
          canUseBiometrics: false,
          hasBiometric: false,
          biometricLabel: 'App unlock');
  @override
  Future<void> saveVerifiedDevicePin(String pin) async {}
}

Finder _field(String label) => find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.labelText == label);
Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  if (Platform.environment['TRUSTPAY_SEND_CAPTURE'] != '1') return;
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final picture = await boundary.toImage(pixelRatio: 2);
    final data = await picture.toByteData(format: ui.ImageByteFormat.png);
    final file = File('../output/send-money/$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(data!.buffer.asUint8List());
    picture.dispose();
  });
}

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (Platform.environment['TRUSTPAY_SEND_CAPTURE'] != '1') return;
    final icons = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await icons.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await icons.readAsBytes()))))
          .load();
    }
  });
  for (final dark in [false, true]) {
    testWidgets(
        'review, PIN and receipt fit ${dark ? '320px large dark' : '390px light'}',
        (tester) async {
      final size = Size(dark ? 320 : 390, dark ? 740 : 844);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      setMockSecureStorage();
      final bundle = buildTrustPayTestBundle();
      final capture = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(
          key: capture,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: dark ? AppTheme.dark : AppTheme.light,
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(dark ? 1.5 : 1)),
                child: child!),
            home: MoneyActionScreen(
                kind: MoneyActionKind.send,
                apiClient: bundle.apiClient,
                transactionSecurityService: _Security()),
          )));
      await tester.pumpAndSettle();
      await tester.enterText(_field('Amount'), '12500.50');
      await tester.pump();
      await _capture(tester, capture, 'amount-${dark ? 'dark' : 'light'}');
      await openTransferRecipient(tester);
      await tester.ensureVisible(_field('Recipient email'));
      await openTransferRecipient(tester);
      await tester.enterText(_field('Recipient email'), 'tolu@example.com');
      await tester.pump(const Duration(milliseconds: 700));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Review transfer'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await _capture(tester, capture, 'review-${dark ? 'dark' : 'light'}');
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await _capture(
          tester, capture, 'confirmation-${dark ? 'dark' : 'light'}');
      expect(tester.getBottomRight(find.text('0')).dy,
          lessThanOrEqualTo(size.height),
          reason: 'The full PIN keypad must fit without scrolling.');
      for (final digit in ['2', '4', '6', '8']) {
        await tester.ensureVisible(find.text(digit));
        await tester.tap(find.text(digit));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Money sent'), findsOneWidget);
      await _capture(tester, capture, 'receipt-${dark ? 'dark' : 'light'}');
      await tester.pumpWidget(const SizedBox());
    });
  }
}
