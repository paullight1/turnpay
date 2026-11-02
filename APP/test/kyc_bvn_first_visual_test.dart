import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:trustpay_app/features/home/widgets/kyc_status_widgets.dart';
import 'package:trustpay_app/services/kyc_service.dart';

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (Platform.environment['BVN_KYC_CAPTURE'] != '1') return;
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
    (
      name: 'mobile-tier-one',
      size: const Size(430, 932),
      dark: false,
      scale: 1.0,
      tier: 'TIER_1',
      bvn: 'VERIFIED'
    ),
    (
      name: 'mobile-start',
      size: const Size(430, 932),
      dark: false,
      scale: 1.0,
      tier: 'TIER_0',
      bvn: 'UNVERIFIED'
    ),
    (
      name: 'mobile-dark-large',
      size: const Size(320, 740),
      dark: true,
      scale: 1.5,
      tier: 'TIER_1',
      bvn: 'VERIFIED'
    ),
  ]) {
    testWidgets('BVN-first overview fits ${variant.name}', (tester) async {
      tester.view.physicalSize = variant.size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final key = GlobalKey();
      final overview = KycOverview.fromJson({
        'kycStatus': variant.tier == 'TIER_1' ? 'VERIFIED' : 'PENDING',
        'kycTier': variant.tier,
        'providerValidationStatus': variant.bvn,
        'accountProvisioning': {'status': 'PENDING'}
      });
      await tester.pumpWidget(RepaintBoundary(
          key: key,
          child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: variant.dark ? AppTheme.dark : AppTheme.light,
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(variant.scale)),
                  child: child!),
              home: Scaffold(
                  appBar: AppBar(
                      foregroundColor:
                          variant.dark ? Colors.white : Colors.black,
                      title: const Text('Verification')),
                  body: KycStatusOverview(
                      overview: overview,
                      onDetails: (_) {},
                      onStartBvn: () {},
                      onStartNin: () {},
                      onHistory: () {},
                      onAccount: () {})))));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(
          find.text(variant.tier == 'TIER_1'
              ? 'Your account is active'
              : 'Activate your account'),
          findsOneWidget);
      if (Platform.environment['BVN_KYC_CAPTURE'] == '1') {
        await tester.runAsync(() async {
          final boundary =
              key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          final picture = await boundary.toImage(pixelRatio: 2);
          final bytes =
              await picture.toByteData(format: ui.ImageByteFormat.png);
          final file = File('../output/kyc-bvn-first/${variant.name}.png');
          await file.parent.create(recursive: true);
          await file.writeAsBytes(bytes!.buffer.asUint8List());
          picture.dispose();
        });
      }
    });
  }
}
