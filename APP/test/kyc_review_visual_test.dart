import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/screens/kyc_verification_screen.dart';
import 'package:trustpay_app/features/home/widgets/kyc_status_widgets.dart';
import 'package:trustpay_app/services/kyc_service.dart';

const bothPending = KycOverview(
    status: 'SUBMITTED',
    tier: 'TIER_0',
    provider: 'Paystack',
    providerValidationStatus: 'PENDING',
    reference: '',
    failureReason: '',
    verificationUri: null,
    updatedAt: null,
    documents: [
      KycDocumentSummary(type: 'NIN', status: 'SUBMITTED', updatedAt: null),
      KycDocumentSummary(type: 'BVN', status: 'SUBMITTED', updatedAt: null)
    ]);

class _StatusService extends KycService {
  @override
  Future<KycOverview> fetchOverview(
          {bool includeIdentityProfile = false}) async =>
      bothPending;
}

Future<void> capture(WidgetTester tester, GlobalKey key, String name) async {
  if (Platform.environment['KYC_REVIEW_CAPTURE'] != '1') return;
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final picture = await boundary.toImage(pixelRatio: 2);
    final bytes = await picture.toByteData(format: ui.ImageByteFormat.png);
    final file = File('../output/kyc-review/$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(bytes!.buffer.asUint8List());
    picture.dispose();
  });
}

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (Platform.environment['KYC_REVIEW_CAPTURE'] != '1') return;
    final file = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await file.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await file.readAsBytes()))))
          .load();
    }
  });
  for (final variant in [
    (name: '430-light', size: const Size(430, 932), dark: false, scale: 1.0),
    (
      name: '320-dark-large',
      size: const Size(320, 740),
      dark: true,
      scale: 1.5
    ),
    (name: '726-light', size: const Size(726, 804), dark: false, scale: 1.0),
  ]) {
    testWidgets('KYC status and confirmation fit ${variant.name}',
        (tester) async {
      tester.view.physicalSize = variant.size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final key = GlobalKey();
      Widget render(Widget child) => RepaintBoundary(
          key: key,
          child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: variant.dark ? AppTheme.dark : AppTheme.light,
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(variant.scale)),
                  child: child!),
              home: child));
      await tester.pumpWidget(render(KycVerificationScreen(
          service: _StatusService(), initialOverview: bothPending)));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await capture(tester, key, 'status-${variant.name}');
      await tester.ensureVisible(find.byKey(const ValueKey('kyc-status-BVN')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('kyc-status-BVN')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await capture(tester, key, 'bvn-details-${variant.name}');
      await tester.tap(find.byTooltip('Close status'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('View verification history'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('View verification history'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await capture(tester, key, 'history-${variant.name}');
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
      await tester.pumpWidget(render(KycSubmissionConfirmation(
          type: 'BVN',
          verified: false,
          message: 'We’ve received your BVN and linked bank details.',
          onStatus: () {},
          onContinueNin: () {})));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(tester.getBottomRight(find.text('Continue to NIN')).dy,
          lessThanOrEqualTo(variant.size.height));
      await capture(tester, key, 'submitted-${variant.name}');
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    });
  }
}
