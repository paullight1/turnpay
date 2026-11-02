import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/cupertino.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image/image.dart' as img;
import 'package:trustpay_app/core/theme/app_theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/kyc_verification_screen.dart';
import 'package:trustpay_app/services/kyc_service.dart';

Uint8List _sampleNinImage() {
  final image = img.Image(width: 320, height: 200);
  img.fill(image, color: img.ColorRgb8(255, 255, 255));
  img.fillRect(image,
      x1: 0, y1: 0, x2: 319, y2: 38, color: img.ColorRgb8(219, 239, 224));
  img.drawString(image, 'SAMPLE NIN',
      font: img.arial24, x: 12, y: 8, color: img.ColorRgb8(30, 73, 45));
  img.fillRect(image,
      x1: 14, y1: 60, x2: 84, y2: 150, color: img.ColorRgb8(226, 230, 236));
  for (final y in [68, 98, 128]) {
    img.fillRect(image,
        x1: 108,
        y1: y,
        x2: 292,
        y2: y + 8,
        color: img.ColorRgb8(100, 110, 120));
  }
  return Uint8List.fromList(img.encodePng(image));
}

Future<void> _openBvnVerification(WidgetTester tester) async {
  final action = find.text('Verify BVN');
  await tester.ensureVisible(action);
  await tester.pumpAndSettle();
  if (!tester
      .getRect(action)
      .overlaps(Offset.zero & tester.view.physicalSize)) {
    await tester.drag(
        find.byType(SingleChildScrollView).first, const Offset(0, -300));
    await tester.pumpAndSettle();
  }
  await tester.tap(action);
  await tester.pumpAndSettle();
}

Future<void> _captureKyc(
  WidgetTester tester,
  GlobalKey key,
  String name,
) async {
  if (!const bool.fromEnvironment('KYC_CAPTURE')) return;
  await tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 750)),
  );
  await tester.pumpAndSettle();
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final picture = await boundary.toImage(pixelRatio: 2);
    final bytes = await picture.toByteData(format: ui.ImageByteFormat.png);
    final file = File('../output/kyc-ui/$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(bytes!.buffer.asUint8List());
    picture.dispose();
  });
}

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    if (!const bool.fromEnvironment('KYC_CAPTURE')) return;
    final icons = File(
        '${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts/MaterialIcons-Regular.otf');
    if (await icons.exists()) {
      await (FontLoader('MaterialIcons')
            ..addFont(
                Future.value(ByteData.sublistView(await icons.readAsBytes()))))
          .load();
    }
  });
  testWidgets('collects a phone number with legal name before bank details',
      (tester) async {
    final service = _FakeKycService();
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
            service: service, initialOverview: _pendingOverview)));
    await tester.pumpAndSettle();
    await _openBvnVerification(tester);
    expect(find.byKey(const ValueKey('kyc-phone')), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('kyc-first-name')), 'Ada');
    await tester.enterText(
        find.byKey(const ValueKey('kyc-last-name')), 'Lovelace');
    await tester.enterText(find.byKey(const ValueKey('kyc-phone')), '123');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-bank-picker')), findsNothing);
    expect(find.textContaining('Enter a valid Nigerian phone number'),
        findsWidgets);
    await tester.enterText(
        find.byKey(const ValueKey('kyc-phone')), '0801 234 5678');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-bank-picker')), findsOneWidget);
    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('kyc-phone')))
            .controller!
            .text,
        '0801 234 5678');
  });
  Future<void> review(WidgetTester tester, _FakeKycService service) async {
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
            service: service, initialOverview: _pendingOverview)));
    await tester.pumpAndSettle();
    await _openBvnVerification(tester);
    await tester.enterText(find.byKey(const ValueKey('kyc-first-name')), 'Ada');
    await tester.enterText(
        find.byKey(const ValueKey('kyc-last-name')), 'Lovelace');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-bank-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Test Bank'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('kyc-account-number')), '0123456789');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('kyc-identity-number')), '77777777777');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-date-of-birth-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-date-picker-done')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
  }

  testWidgets(
      'review masks phone and editing preserves bank and identity details',
      (tester) async {
    final service = _FakeKycService();
    await review(tester, service);
    expect(find.text('+234 ••• ••• 5678'), findsOneWidget);
    expect(find.text('+2348012345678'), findsNothing);
    await tester.ensureVisible(find.text('Edit personal details'));
    await tester.tap(find.text('Edit personal details'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-phone')), findsOneWidget);
    await tester.enterText(
        find.byKey(const ValueKey('kyc-phone')), '08099887766');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('kyc-account-number')))
            .controller!
            .text,
        '0123456789');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(
                find.byKey(const ValueKey('kyc-identity-number')))
            .controller!
            .text,
        '77777777777');
  });
  testWidgets(
      'profile-save failure returns to personal details without starting KYC',
      (tester) async {
    final service = _FakeKycService()..profileSaveFails = true;
    await review(tester, service);
    final consent = find.byKey(const ValueKey('kyc-consent'));
    await tester.ensureVisible(consent);
    await tester.tap(consent);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Submit verification'));
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    expect(service.attemptKeys, isEmpty);
    expect(find.byKey(const ValueKey('kyc-phone')), findsOneWidget);
    expect(
        find.text(
            'Could not save your legal name and phone number. Try again.'),
        findsOneWidget);
    expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('kyc-first-name')))
            .controller!
            .text,
        'Ada');
    expect(tester.takeException(), isNull);
  });
  testWidgets(
      'locked incomplete profile explains support before collecting BVN',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
            service: _FakeKycService(),
            initialOverview: const KycOverview(
                firstName: 'Ada',
                lastName: 'Lovelace',
                phone: '',
                profileIdentityLocked: true,
                status: 'PENDING',
                tier: 'TIER_0',
                provider: 'Paystack',
                reference: '',
                failureReason: '',
                verificationUri: null,
                updatedAt: null,
                documents: []))));
    await tester.pumpAndSettle();
    await _openBvnVerification(tester);
    expect(find.text('Contact support'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-bank-picker')), findsNothing);
    expect(find.byKey(const ValueKey('kyc-identity-number')), findsNothing);
    expect(find.text(kycLockedProfileMessage), findsWidgets);
  });
  testWidgets(
      'saved personal details stay protected after a rejected KYC attempt',
      (tester) async {
    final service = _FakeKycService()..rejectFirstAttempt = true;
    await review(tester, service);
    final consent = find.byKey(const ValueKey('kyc-consent'));
    await tester.ensureVisible(consent);
    await tester.tap(consent);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Submit verification'));
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Edit personal details'));
    await tester.tap(find.text('Edit personal details'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('kyc-phone')))
            .readOnly,
        isTrue);
    expect(find.text('Contact support'), findsOneWidget);
  });
  testWidgets('an unchanged unlocked profile stays editable after rejection',
      (tester) async {
    final service = _FakeKycService()
      ..rejectFirstAttempt = true
      ..profileBecomesLocked = false;
    await review(tester, service);
    final consent = find.byKey(const ValueKey('kyc-consent'));
    await tester.ensureVisible(consent);
    await tester.tap(consent);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Submit verification'));
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Edit personal details'));
    await tester.tap(find.text('Edit personal details'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('kyc-phone')))
            .readOnly,
        isFalse);
    expect(find.text('Contact support'), findsNothing);
  });
  testWidgets('a profile-read rejection preserves an uncertain KYC attempt key',
      (tester) async {
    final service = _FakeKycService()
      ..timeoutFirstAttempt = true
      ..rejectSecondProfileRead = true;
    await review(tester, service);
    final consent = find.byKey(const ValueKey('kyc-consent'));
    await tester.ensureVisible(consent);
    await tester.tap(consent);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Submit verification'));
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    expect(service.attemptKeys, hasLength(1));
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-phone')), findsOneWidget);
    for (var step = 0; step < 4; step++) {
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
    }
    await tester.ensureVisible(find.text('Submit verification'));
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    expect(service.attemptKeys, hasLength(2));
    expect(service.attemptKeys.last, service.attemptKeys.first);
  });
  testWidgets('BVN in review offers NIN next and independent status details',
      (tester) async {
    final service = _FakeKycService();
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
            service: service,
            initialOverview: const KycOverview(
                status: 'SUBMITTED',
                tier: 'TIER_0',
                provider: 'Paystack',
                providerValidationStatus: 'PENDING',
                reference: 'bvn-review',
                failureReason: '',
                verificationUri: null,
                updatedAt: null,
                documents: []))));
    await tester.pumpAndSettle();
    expect(find.text('Continue to NIN'), findsOneWidget);
    expect(
        find.text(
            'Paystack is reviewing your BVN and linked bank account. Your existing KYC tier remains unchanged.'),
        findsNothing);
    await tester.tap(find.byKey(const ValueKey('kyc-status-BVN')));
    await tester.pumpAndSettle();
    expect(find.text('BVN status'), findsOneWidget);
    expect(find.text('Check status'), findsOneWidget);
    expect(service.attemptKeys, isEmpty);
  });
  testWidgets('both review cards open status and verification history',
      (tester) async {
    final service = _FakeKycService();
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
            service: service,
            initialOverview: const KycOverview(
                status: 'SUBMITTED',
                tier: 'TIER_0',
                provider: 'Paystack',
                providerValidationStatus: 'PENDING',
                reference: '',
                failureReason: '',
                verificationUri: null,
                updatedAt: null,
                documents: [
                  KycDocumentSummary(
                      type: 'BVN', status: 'SUBMITTED', updatedAt: null),
                  KycDocumentSummary(
                      type: 'NIN', status: 'SUBMITTED', updatedAt: null)
                ]))));
    await tester.pumpAndSettle();
    expect(find.text('Under review'), findsNWidgets(2));
    await tester.tap(find.byKey(const ValueKey('kyc-status-NIN')));
    await tester.pumpAndSettle();
    expect(find.text('NIN status'), findsOneWidget);
    expect(find.text('Your NIN document is with our review team.'),
        findsOneWidget);
    await tester.tap(find.byTooltip('Close status'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('View verification history'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('View verification history'));
    await tester.pumpAndSettle();
    expect(find.text('Verification history'), findsOneWidget);
    expect(service.attemptKeys, isEmpty);
  });
  testWidgets('submitted BVN shows a simple confirmation then continues to NIN',
      (tester) async {
    final service = _FakeKycService()..reviewAfterSubmission = true;
    await review(tester, service);
    await tester.ensureVisible(find.byKey(const ValueKey('kyc-consent')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-consent')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    expect(find.text('BVN under review'), findsOneWidget);
    expect(find.text('We’ve received your BVN and linked bank details.'),
        findsOneWidget);
    await tester.tap(find.text('Continue to NIN'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-nin-number')), findsOneWidget);
    expect(service.attemptKeys, hasLength(1));
    expect(service.ninSubmissions, 0);
  });
  testWidgets(
      'accepted BVN stays in review through stale reads until an explicit result',
      (tester) async {
    final service = _FakeKycService()..reviewAfterSubmission = true;
    await review(tester, service);
    final consent = find.byKey(const ValueKey('kyc-consent'));
    await tester.ensureVisible(consent);
    await tester.pumpAndSettle();
    await tester.tap(consent);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('View verification status'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 15));
    await tester.pumpAndSettle();
    expect(find.text('Under review'), findsOneWidget);
    expect(find.text('Continue to NIN'), findsOneWidget);
    expect(service.attemptKeys, hasLength(1));
    service.overview = const KycOverview(
        status: 'REJECTED',
        tier: 'TIER_0',
        provider: 'Paystack',
        providerValidationStatus: 'FAILED',
        reference: 'paystack-verification-1',
        failureReason: '',
        verificationUri: null,
        updatedAt: null,
        documents: []);
    await tester.pump(const Duration(seconds: 15));
    await tester.pumpAndSettle();
    expect(find.text('Needs attention'), findsOneWidget);
    expect(find.text('Verify BVN'), findsOneWidget);
    expect(service.attemptKeys, hasLength(1));
  });
  testWidgets('a failed status refresh preserves the last result and can retry',
      (tester) async {
    final service = _FakeKycService()..failStatusRefresh = true;
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
            service: service, initialOverview: _bvnInReview)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-status-BVN')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Check status'));
    await tester.pumpAndSettle();
    expect(find.text('Under review'), findsNWidgets(2));
    expect(
        find.text(
            'Could not refresh status. Your last result is shown. Try again.'),
        findsOneWidget);
    service.failStatusRefresh = false;
    service.overview = const KycOverview(
        status: 'VERIFIED',
        tier: 'TIER_1',
        provider: 'Paystack',
        providerValidationStatus: 'VERIFIED',
        reference: 'bvn-review',
        failureReason: '',
        verificationUri: null,
        updatedAt: null,
        documents: []);
    await tester.tap(find.text('Check status'));
    await tester.pumpAndSettle();
    expect(service.fetchCount, 2);
    expect(find.text('Your BVN check is complete.'), findsOneWidget);
    expect(
        find.text(
            'Could not refresh status. Your last result is shown. Try again.'),
        findsNothing);
    expect(service.attemptKeys, isEmpty);
  });
  testWidgets('NIN evidence can be submitted while BVN is under review',
      (tester) async {
    const channel = MethodChannel('miguelruivo.flutter.plugins.filepicker');
    final bytes = _sampleNinImage();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            channel,
            (call) async => [
                  {
                    'name': 'nin.png',
                    'size': bytes.length,
                    'bytes': bytes,
                    'path': '/test/nin.png'
                  }
                ]);
    addTearDown(() => TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null));
    final service = _FakeKycService()..overview = _bvnInReview;
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
            service: service, initialOverview: _bvnInReview)));
    await tester.pumpAndSettle();
    Future<void> tap(Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    await tap(find.text('Continue to NIN'));
    final ninField =
        tester.widget<TextField>(find.byKey(const ValueKey('kyc-nin-number')));
    expect(ninField.obscureText, isFalse);
    expect(ninField.enableSuggestions, isFalse);
    expect(ninField.autocorrect, isFalse);
    await tester.enterText(
        find.byKey(const ValueKey('kyc-nin-number')), '77777777777');
    await tap(find.text('Upload NIN'));
    await tester.drag(find.byType(ListView).last, const Offset(0, -240));
    await tester.pumpAndSettle();
    await tap(find.byKey(const ValueKey('kyc-nin-consent')));
    expect(service.ninSubmissions, 0);
    await tap(find.text('Submit for review'));
    expect(service.ninSubmissions, 1,
        reason: tester
            .widgetList<Text>(find.byType(Text))
            .map((t) => t.data)
            .join(' | '));
    expect(find.text('NIN under review'), findsOneWidget);
    await tap(find.text('View verification status'));
    expect(find.text('Under review'), findsNWidgets(2));
    expect(find.text('Continue to NIN'), findsNothing);
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
    testWidgets('NIN file preview and consent fit ${variant.name}',
        (tester) async {
      tester.view.physicalSize = variant.size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      const channel = MethodChannel('miguelruivo.flutter.plugins.filepicker');
      final bytes = _sampleNinImage();
      var selections = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        selections++;
        if (selections == 2) return null;
        return [
          {
            'name': selections == 1 ? 'nin-slip.png' : 'nin-card.png',
            'size': bytes.length,
            'bytes': bytes,
            'path': '/test/nin.png',
          }
        ];
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding
          .instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null));
      final capture = GlobalKey();
      final service = _FakeKycService()..overview = _bvnInReview;
      await tester.pumpWidget(RepaintBoundary(
        key: capture,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: variant.dark ? AppTheme.dark : AppTheme.light,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(variant.scale)),
            child: child!,
          ),
          home: KycVerificationScreen(
              service: service, initialOverview: _bvnInReview),
        ),
      ));
      await tester.pumpAndSettle();
      Future<void> tap(Finder finder) async {
        await tester.ensureVisible(finder);
        await tester.pumpAndSettle();
        await tester.tap(finder);
        await tester.pumpAndSettle();
      }

      await tap(find.text('Continue to NIN'));
      await tester.enterText(
          find.byKey(const ValueKey('kyc-nin-number')), '77777777777');
      await tap(find.text('Upload NIN'));
      expect(find.text('nin-slip.png'), findsOneWidget);
      expect(
          find.bySemanticsLabel('Selected NIN image preview'), findsOneWidget);
      final submit = find.widgetWithText(ElevatedButton, 'Submit for review');
      expect(tester.widget<ElevatedButton>(submit).onPressed, isNull);
      expect(tester.getSize(submit).height, greaterThanOrEqualTo(54));
      expect(tester.getSize(find.text('Cancel')).height, lessThan(40));
      await tap(find.text('Upload NIN'));
      expect(find.text('nin-slip.png'), findsOneWidget);
      await tap(find.text('Upload NIN'));
      expect(find.text('nin-slip.png'), findsNothing);
      expect(find.text('nin-card.png'), findsOneWidget);
      await tap(find.byKey(const ValueKey('kyc-nin-consent')));
      expect(tester.widget<ElevatedButton>(submit).onPressed, isNotNull);
      expect(service.ninSubmissions, 0);
      expect(tester.takeException(), isNull);
      await _captureKyc(tester, capture, 'nin-upload-${variant.name}');
      await tap(find.text('Cancel'));
      expect(service.ninSubmissions, 0);
    });
  }
  testWidgets('pending review refreshes to approval without resubmission',
      (tester) async {
    final service = _FakeKycService();
    service.overview = const KycOverview(
      status: 'VERIFIED',
      tier: 'TIER_2',
      provider: 'Paystack',
      providerValidationStatus: 'VERIFIED',
      reference: 'review-result',
      failureReason: '',
      verificationUri: null,
      updatedAt: null,
      documents: [
        KycDocumentSummary(type: 'NIN', status: 'VERIFIED', updatedAt: null),
        KycDocumentSummary(type: 'BVN', status: 'VERIFIED', updatedAt: null),
      ],
    );
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
      service: service,
      initialOverview: const KycOverview(
        status: 'SUBMITTED',
        tier: 'TIER_0',
        provider: 'Paystack',
        providerValidationStatus: 'PENDING',
        reference: 'review-result',
        failureReason: '',
        verificationUri: null,
        updatedAt: null,
        documents: [],
      ),
    )));
    await tester.pump();
    expect(find.text('Under review'), findsOneWidget);
    expect(find.text('Continue'), findsNothing);
    await tester.pump(const Duration(seconds: 15));
    await tester.pump();
    await tester.pumpAndSettle();
    expect(service.fetchCount, 1);
    expect(find.text('Your NIN and BVN are verified.'), findsOneWidget,
        reason: tester
            .widgetList<Text>(find.byType(Text))
            .map((text) => text.data)
            .join(' | '));
    expect(find.text('Under review'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets(
      'manual NIN review refreshes without requiring another submission',
      (tester) async {
    final service = _FakeKycService();
    service.overview = const KycOverview(
      status: 'VERIFIED',
      tier: 'TIER_2',
      provider: 'Paystack',
      providerValidationStatus: 'VERIFIED',
      reference: 'review-result',
      failureReason: '',
      verificationUri: null,
      updatedAt: null,
      documents: [
        KycDocumentSummary(type: 'NIN', status: 'VERIFIED', updatedAt: null),
        KycDocumentSummary(type: 'BVN', status: 'VERIFIED', updatedAt: null),
      ],
    );
    await tester.pumpWidget(MaterialApp(
        home: KycVerificationScreen(
      service: service,
      initialOverview: const KycOverview(
        status: 'SUBMITTED',
        tier: 'TIER_0',
        provider: 'Paystack',
        providerValidationStatus: 'VERIFIED',
        reference: 'review-result',
        failureReason: '',
        verificationUri: null,
        updatedAt: null,
        documents: [
          KycDocumentSummary(type: 'BVN', status: 'VERIFIED', updatedAt: null),
          KycDocumentSummary(type: 'NIN', status: 'SUBMITTED', updatedAt: null),
        ],
      ),
    )));
    await tester.pump();
    expect(find.text('Under review'), findsOneWidget);
    await tester.pump(const Duration(seconds: 15));
    await tester.pump();
    await tester.pumpAndSettle();
    expect(service.fetchCount, 1);
    expect(find.text('Your NIN and BVN are verified.'), findsOneWidget,
        reason: tester
            .widgetList<Text>(find.byType(Text))
            .map((text) => text.data)
            .join(' | '));
    await tester.pumpWidget(const SizedBox.shrink());
  });
  test('Paystack result reads the safe backend response', () {
    final result = KycVerificationResult.fromJson({
      'provider': 'PAYSTACK',
      'verificationStatus': 'VERIFIED',
      'reference': 'paystack-verification-1',
    });

    expect(result.provider, 'Paystack');
    expect(result.status, 'VERIFIED');
    expect(result.reference, 'paystack-verification-1');
  });

  for (final dark in [false, true]) {
    testWidgets(
        'KYC personal details fit ${dark ? '320px dark large text' : '430px light'}',
        (tester) async {
      tester.view.physicalSize =
          dark ? const Size(320, 740) : const Size(430, 932);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      final capture = GlobalKey();
      final service = _FakeKycService();
      await tester.pumpWidget(
        RepaintBoundary(
          key: capture,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: dark ? AppTheme.dark : AppTheme.light,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(dark ? 1.5 : 1),
              ),
              child: child!,
            ),
            home: KycVerificationScreen(
              service: service,
              initialOverview: _pendingOverview,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await _captureKyc(
          tester, capture, 'overview-${dark ? '320-dark-large' : '430-light'}');

      await _openBvnVerification(tester);
      expect(find.text('Confirm your legal name'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _captureKyc(tester, capture,
          'bvn-personal-details-${dark ? '320-dark-large' : '430-light'}');

      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      await tester.pumpAndSettle();
      expect(
        tester.getBottomRight(find.text('Continue')).dy,
        lessThan((dark ? 740 : 932) - 280),
      );
      expect(tester.takeException(), isNull);
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();

      await tester.enterText(
          find.byKey(const ValueKey('kyc-first-name')), 'Ada');
      await tester.enterText(
          find.byKey(const ValueKey('kyc-last-name')), 'Lovelace');
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('kyc-bank-picker')), findsOneWidget);
      await _captureKyc(
          tester, capture, 'bvn-bank-${dark ? '320-dark-large' : '430-light'}');

      await tester.tap(find.byKey(const ValueKey('kyc-bank-picker')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Test Bank'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('kyc-account-number')),
        '0123456789',
      );
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('kyc-identity-number')),
        '11111111111',
      );
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('kyc-date-of-birth-picker')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('kyc-date-picker-done')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(find.text('Check your details'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _captureKyc(tester, capture,
          'bvn-review-${dark ? '320-dark-large' : '430-light'}');
    });
  }

  testWidgets('shows a focused form without redundant context', (tester) async {
    final service = _FakeKycService();
    await tester.pumpWidget(
      MaterialApp(
        home: KycVerificationScreen(
          service: service,
          initialOverview: _pendingOverview,
        ),
      ),
    );
    await tester.pump();

    expect(find.text('KYC verification'), findsOneWidget);
    expect(
      find.text('Complete two checks. Follow their progress here.'),
      findsOneWidget,
    );
    expect(find.text('Country'), findsNothing);
    expect(find.text('Current access'), findsNothing);
    expect(find.text('Nigeria'), findsNothing);
    expect(find.text('Ghana'), findsNothing);
    expect(find.text('NIN verification'), findsOneWidget);
    expect(find.text('BVN verification'), findsOneWidget);
    expect(find.text('Verify NIN'), findsNothing);
    await _openBvnVerification(tester);
    expect(find.byKey(const ValueKey('kyc-identity-number')), findsNothing);
    await tester.enterText(find.byType(TextField).at(0), 'Ada');
    await tester.enterText(find.byType(TextField).at(1), 'Lovelace');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-bank-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Test Bank'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('kyc-account-number')),
      '0123456789',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-identity-number')), findsOneWidget);
    expect(
        tester
            .widget<TextField>(
                find.byKey(const ValueKey('kyc-identity-number')))
            .obscureText,
        isFalse);
    expect(find.text('Date of birth'), findsNothing);
    await tester.enterText(
      find.byKey(const ValueKey('kyc-identity-number')),
      '11111111111',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Date of birth'), findsOneWidget);
    expect(
        find.byKey(const ValueKey('kyc-date-of-birth-picker')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('kyc-date-of-birth-picker')));
    await tester.pumpAndSettle();
    expect(find.byType(CupertinoDatePicker), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('kyc-date-picker-done')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(
        find.textContaining('shared securely with Paystack'), findsOneWidget);
    expect(
      find.text(
          'I agree to share my identity and bank details securely with Paystack for verification.'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('kyc-consent')), findsOneWidget);
    expect(
        find.textContaining('dedicated NGN receiving account'), findsOneWidget);
    expect(
        find.descendant(
            of: find.ancestor(
                of: find.byKey(const ValueKey('kyc-consent')),
                matching: find.byType(Scaffold)),
            matching: find.text('View verification history')),
        findsNothing);
  });

  testWidgets('submits BVN, linked bank details and separate account consent',
      (tester) async {
    final service = _FakeKycService();
    await tester.pumpWidget(
      MaterialApp(
        home: KycVerificationScreen(
          service: service,
          initialOverview: _pendingOverview,
        ),
      ),
    );
    await tester.pump();
    await _openBvnVerification(tester);

    await tester.enterText(find.byType(TextField).at(0), 'Ada');
    await tester.enterText(find.byType(TextField).at(1), 'Lovelace');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-bank-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Test Bank'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('kyc-account-number')),
      '0123456789',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('kyc-identity-number')),
      '77777777777',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-date-of-birth-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-date-picker-done')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    tester.testTextInput.hide();
    await tester.pump();
    final identityConsent = find.byKey(const ValueKey('kyc-consent'));
    await tester.ensureVisible(identityConsent);
    await tester.tap(identityConsent);
    final accountConsent =
        find.byKey(const ValueKey('kyc-account-setup-consent'));
    await tester.ensureVisible(accountConsent);
    await tester.tap(accountConsent);
    await tester.ensureVisible(find.text('Submit verification'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();

    expect(service.savedPhone, '+2348012345678');
    expect(service.calls.take(2), ['profile', 'verify']);
    expect(service.submittedIdNumber, '77777777777');
    expect(service.submittedDateOfBirth, '1990-01-01');
    expect(service.submittedCountry, 'NG');
    expect(service.submittedType, 'BVN');
    expect(service.submittedConsent, isTrue);
    expect(service.submittedBankCode, '058');
    expect(service.submittedAccountNumber, '0123456789');
    expect(service.submittedAccountSetupConsent, isTrue);
    expect(find.text('Identity confirmed. Your NGN account is ready.'),
        findsOneWidget);
  });

  testWidgets(
      'rejected KYC attempt can retry without replaying the rejected key',
      (tester) async {
    final service = _FakeKycService()..rejectFirstAttempt = true;
    await tester.pumpWidget(
      MaterialApp(
        home: KycVerificationScreen(
          service: service,
          initialOverview: _pendingOverview,
        ),
      ),
    );
    await tester.pump();
    await _openBvnVerification(tester);

    await tester.enterText(find.byType(TextField).at(0), 'Ada');
    await tester.enterText(find.byType(TextField).at(1), 'Lovelace');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-bank-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Test Bank'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('kyc-account-number')),
      '0123456789',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('kyc-identity-number')),
      '77777777777',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-date-of-birth-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('kyc-date-picker-done')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    tester.testTextInput.hide();
    await tester.pump();
    final identityConsent = find.byKey(const ValueKey('kyc-consent'));
    await tester.ensureVisible(identityConsent);
    await tester.tap(identityConsent);
    final accountConsent =
        find.byKey(const ValueKey('kyc-account-setup-consent'));
    await tester.ensureVisible(accountConsent);
    await tester.tap(accountConsent);
    await tester.ensureVisible(find.text('Submit verification'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();

    expect(find.text('Submit verification'), findsOneWidget);
    await tester.tap(find.text('Submit verification'));
    await tester.pumpAndSettle();
    expect(service.attemptKeys.length, 2);
    expect(service.attemptKeys[0], isNot(service.attemptKeys[1]));

    expect(service.submittedIdNumber, '77777777777');
    expect(service.submittedDateOfBirth, '1990-01-01');
    expect(service.submittedCountry, 'NG');
    expect(service.submittedType, 'BVN');
    expect(service.submittedConsent, isTrue);
    expect(service.submittedBankCode, '058');
    expect(service.submittedAccountNumber, '0123456789');
    expect(service.submittedAccountSetupConsent, isTrue);
    expect(find.text('Identity confirmed. Your NGN account is ready.'),
        findsOneWidget);
  });

  testWidgets('back navigation preserves entered verification details',
      (tester) async {
    final service = _FakeKycService();
    await tester.pumpWidget(
      MaterialApp(
        home: KycVerificationScreen(
          service: service,
          initialOverview: _pendingOverview,
        ),
      ),
    );
    await tester.pump();
    await _openBvnVerification(tester);

    await tester.enterText(find.byKey(const ValueKey('kyc-first-name')), 'Ada');
    await tester.enterText(
        find.byKey(const ValueKey('kyc-last-name')), 'Lovelace');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('kyc-bank-picker')), findsOneWidget);

    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm your legal name'), findsOneWidget);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('kyc-first-name')))
          .controller
          ?.text,
      'Ada',
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('kyc-last-name')))
          .controller
          ?.text,
      'Lovelace',
    );
  });

  testWidgets('blocks each step until its required fields are valid',
      (tester) async {
    final service = _FakeKycService();
    await tester.pumpWidget(
      MaterialApp(
        home: KycVerificationScreen(
          service: service,
          initialOverview: _pendingOverview,
        ),
      ),
    );
    await tester.pump();
    await _openBvnVerification(tester);

    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(
      find.text('Enter your legal first and last name.'),
      findsAtLeastNWidgets(1),
    );

    await tester.enterText(find.byKey(const ValueKey('kyc-first-name')), 'Ada');
    await tester.enterText(
        find.byKey(const ValueKey('kyc-last-name')), 'Lovelace');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(
      find.text(
          'Choose your bank and enter the 10-digit account linked to your BVN.'),
      findsAtLeastNWidgets(1),
    );
    expect(find.byKey(const ValueKey('kyc-bank-picker')), findsOneWidget);
  });

  for (final state in <String, String>{
    'REVIEW_REQUIRED': 'Under review',
    'REJECTED': 'Verify BVN',
    'FAILED': 'Verify BVN',
  }.entries) {
    testWidgets('shows recovery guidance for ${state.key}', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: KycVerificationScreen(
            initialOverview: KycOverview(
              status: state.key,
              tier: 'TIER_0',
              provider: 'Paystack',
              providerValidationStatus:
                  state.key == 'REVIEW_REQUIRED' ? 'PENDING' : 'FAILED',
              reference: 'paystack-state',
              failureReason: '',
              verificationUri: null,
              updatedAt: null,
              documents: const [],
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text(state.value), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      if (state.key != 'REVIEW_REQUIRED') {
        await _openBvnVerification(tester);
        expect(find.text('Confirm your legal name'), findsOneWidget);
        expect(find.text('Continue'), findsOneWidget);
      }
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets('shows a quiet completion state and hides the form at Tier 2',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: KycVerificationScreen(
          initialOverview: KycOverview(
            status: 'VERIFIED',
            tier: 'TIER_2',
            provider: 'Paystack',
            providerValidationStatus: 'VERIFIED',
            reference: 'paystack-complete',
            failureReason: '',
            verificationUri: null,
            updatedAt: null,
            documents: [
              KycDocumentSummary(
                type: 'BVN',
                status: 'VERIFIED',
                updatedAt: null,
              ),
              KycDocumentSummary(
                type: 'NIN',
                status: 'VERIFIED',
                updatedAt: null,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Your NIN and BVN are verified.'), findsOneWidget);
    expect(find.byKey(const ValueKey('kyc-identity-number')), findsNothing);
  });
}

const _pendingOverview = KycOverview(
  phone: '+2348012345678',
  status: 'PENDING',
  tier: 'TIER_0',
  provider: 'Paystack',
  providerValidationStatus: 'UNVERIFIED',
  reference: '',
  failureReason: '',
  verificationUri: null,
  updatedAt: null,
  documents: [],
);

class _FakeKycService extends KycService {
  bool profileSaveFails = false;
  bool failStatusRefresh = false;
  bool reviewAfterSubmission = false;
  int ninSubmissions = 0;
  bool profileBecomesLocked = true;
  final calls = <String>[];
  String? savedPhone;
  @override
  Future<bool> ensureIdentityProfile(
      {required String firstName,
      required String lastName,
      required String phone,
      required int yearOfBirth,
      required String idempotencyKey}) async {
    calls.add('profile');
    if (rejectSecondProfileRead &&
        calls.where((call) => call == 'profile').length == 2) {
      final request = RequestOptions(path: '/api/users/me');
      throw DioException(
          requestOptions: request,
          response: Response(requestOptions: request, statusCode: 429),
          type: DioExceptionType.badResponse);
    }
    if (profileSaveFails) {
      throw const KycProfileException(
          'Could not save your legal name and phone number. Try again.');
    }
    savedPhone = phone;
    return profileBecomesLocked;
  }

  bool rejectFirstAttempt = false;
  bool timeoutFirstAttempt = false;
  bool rejectSecondProfileRead = false;
  final attemptKeys = <String>[];
  int fetchCount = 0;
  KycOverview overview = _pendingOverview;
  String? submittedIdNumber;
  String? submittedDateOfBirth;
  String? submittedCountry;
  String? submittedType;
  bool? submittedConsent;
  String? submittedBankCode;
  String? submittedAccountNumber;
  bool? submittedAccountSetupConsent;

  @override
  Future<PaystackKycRecovery> reconcilePaystack() async =>
      PaystackKycRecovery.fromJson(const {'state': 'AWAITING_PROVIDER'});

  @override
  Future<KycOverview> fetchOverview(
      {bool includeIdentityProfile = false}) async {
    fetchCount++;
    if (failStatusRefresh) throw StateError('Status unavailable');
    return overview;
  }

  @override
  Future<KycDocumentUpload> createDocumentUploadUrl(
          {required String fileName,
          required String contentType,
          required int fileSize,
          String? idempotencyKey}) async =>
      const KycDocumentUpload(
          objectKey: 'kyc/test/nin.pdf',
          signedUrl: 'https://upload.example.test/nin');
  @override
  Future<void> uploadDocumentBytes(
      {required KycDocumentUpload upload,
      required String contentType,
      required Uint8List bytes}) async {}
  @override
  Future<KycVerificationResult> submitManualDocument(
      {required String idempotencyKey,
      required String idNumber,
      required String objectKey,
      required bool consentAccepted}) async {
    ninSubmissions++;
    return const KycVerificationResult(
        status: 'SUBMITTED',
        provider: 'Paystack',
        reference: 'manual:nin-test',
        accountProvisioningStatus: 'NOT_REQUIRED');
  }

  @override
  Future<List<KycBankOption>> fetchBanks() async {
    return const [
      KycBankOption(name: 'Test Bank', code: '058', slug: 'test-bank'),
    ];
  }

  @override
  Future<KycVerificationResult> verifyIdentity({
    required String idempotencyKey,
    required String idNumber,
    required String dateOfBirth,
    required bool consentAccepted,
    String? firstName,
    String? lastName,
    String country = 'NG',
    String type = 'BVN',
    String? bankCode,
    String? accountNumber,
    bool accountSetupConsent = false,
  }) async {
    calls.add('verify');
    attemptKeys.add(idempotencyKey);
    if (timeoutFirstAttempt && attemptKeys.length == 1) {
      throw DioException(
          requestOptions: RequestOptions(path: '/api/kyc/verify'),
          type: DioExceptionType.receiveTimeout);
    }
    if (rejectFirstAttempt && attemptKeys.length == 1) {
      final request = RequestOptions(path: '/api/kyc/verify');
      throw DioException(
        requestOptions: request,
        response: Response(
            requestOptions: request,
            statusCode: 422,
            data: {'message': 'Check your details and retry.'}),
        type: DioExceptionType.badResponse,
      );
    }
    submittedIdNumber = idNumber;
    submittedDateOfBirth = dateOfBirth;
    submittedCountry = country;
    submittedType = type;
    submittedConsent = consentAccepted;
    submittedBankCode = bankCode;
    submittedAccountNumber = accountNumber;
    submittedAccountSetupConsent = accountSetupConsent;
    return KycVerificationResult(
      status: reviewAfterSubmission ? 'SUBMITTED' : 'VERIFIED',
      provider: 'Paystack',
      reference: 'paystack-verification-1',
      accountProvisioningStatus: reviewAfterSubmission ? 'PENDING' : 'READY',
    );
  }
}

const _bvnInReview = KycOverview(
    status: 'SUBMITTED',
    tier: 'TIER_0',
    provider: 'Paystack',
    providerValidationStatus: 'PENDING',
    reference: 'bvn-review',
    failureReason: '',
    verificationUri: null,
    updatedAt: null,
    documents: []);
