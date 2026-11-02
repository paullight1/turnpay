import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:trustpay_app/services/home_data_service.dart';
import 'package:trustpay_app/services/kyc_service.dart';
import 'package:trustpay_app/features/home/widgets/kyc_status_presenter.dart';
import 'package:trustpay_app/features/home/widgets/kyc_status_widgets.dart';

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);
  test('unknown or malformed tiers never unlock money routes', () {
    for (final tier in ['TIER_99', 'TIER_-1', 'invalid2', '']) {
      expect(
          KycGatePolicy.isBlocked(
              route: '/withdraw', status: 'VERIFIED', kycTier: tier),
          isTrue,
          reason: tier);
      expect(KycGatePolicy.isTier2OrHigher(tier), isFalse, reason: tier);
    }
  });

  testWidgets(
      'pending BVN confirmation cannot advertise active Tier 1 or offer NIN',
      (tester) async {
    var continued = false;
    await tester.pumpWidget(MaterialApp(
        home: KycSubmissionConfirmation(
      type: 'BVN',
      verified: false,
      message: 'Your check is pending.',
      onStatus: () {},
      onContinueNin: () => continued = true,
    )));
    await tester.pumpAndSettle();
    expect(find.text('Continue to NIN'), findsNothing);
    expect(find.text('Tier 1 is active. Add NIN when you’re ready for Tier 2.'),
        findsNothing);
    await tester.tap(find.text('View verification status'));
    expect(continued, isFalse);
  });
  testWidgets('account restrictions take precedence over an earned tier',
      (tester) async {
    final overview = KycOverview.fromJson({
      'isSuspended': true,
      'kycStatus': 'VERIFIED',
      'kycTier': 'TIER_1',
      'providerValidationStatus': 'VERIFIED'
    });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: KycStatusOverview(
                overview: overview,
                onDetails: (_) {},
                onStartBvn: () {},
                onStartNin: () {},
                onHistory: () {},
                onAccount: () {}))));
    await tester.pumpAndSettle();
    expect(find.text('Your account is under review'), findsOneWidget);
    expect(find.text('Upgrade to Tier 2'), findsNothing);
  });
  test('Tier 1 can use every supported money route, Tier 0 cannot', () {
    for (final route in [
      '/send/trustpay',
      '/send/bank',
      '/withdraw',
      '/exchange',
      '/airtime',
      '/data',
      '/electricity',
      '/cable',
      '/virtual-account'
    ]) {
      expect(
          KycGatePolicy.isBlocked(
              route: route, status: 'VERIFIED', kycTier: 'TIER_1'),
          isFalse,
          reason: route);
      expect(
          KycGatePolicy.isBlocked(
              route: route, status: 'PENDING', kycTier: 'TIER_0'),
          isTrue,
          reason: route);
    }
  });
  test('pending NIN never overrides the server verified Tier 1 status', () {
    final overview = KycOverview.fromJson({
      'kycStatus': 'VERIFIED',
      'kycTier': 'TIER_1',
      'providerValidationStatus': 'VERIFIED',
      'latestVerification': {'status': 'REVIEW_REQUIRED'},
      'documents': [
        {'type': 'NIN', 'status': 'SUBMITTED'}
      ]
    });
    expect(overview.isVerified, isTrue);
    expect(kycCheckStatus(overview, 'NIN'), 'SUBMITTED');
  });
  test('NIN upgrade waits for a completed BVN', () {
    final pending = KycOverview.fromJson({
      'kycStatus': 'PENDING',
      'kycTier': 'TIER_0',
      'providerValidationStatus': 'PENDING'
    });
    expect(kycCanStartNin(pending), isFalse);
  });
  test('an amount beyond Tier 1 offers an upgrade, within the cap continues',
      () {
    final overview = KycOverview.fromJson({
      'kycStatus': 'VERIFIED',
      'kycTier': 'TIER_1',
      'tierOneLimits': {'perTransaction': '100.00'}
    });
    expect(kycActionLimitGate(overview, '100.00', 'NGN'), isNull);
    expect(kycActionLimitGate(overview, '100.01', 'NGN')?.upgrade, isTrue);
  });
  test(
      'missing server limits give an availability message, not a false upgrade requirement',
      () {
    final overview = KycOverview.fromJson(
        {'kycStatus': 'VERIFIED', 'kycTier': 'TIER_1', 'tierOneLimits': null});
    expect(kycActionLimitGate(overview, '10.00', 'NGN')?.upgrade, isFalse);
  });
  testWidgets('Tier 1 overview is active with a secondary NIN upgrade',
      (tester) async {
    final overview = KycOverview.fromJson({
      'kycStatus': 'VERIFIED',
      'kycTier': 'TIER_1',
      'providerValidationStatus': 'VERIFIED'
    });
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: KycStatusOverview(
                overview: overview,
                onDetails: (_) {},
                onStartBvn: () {},
                onStartNin: () {},
                onHistory: () {},
                onAccount: () {}))));
    await tester.pumpAndSettle();
    expect(find.text('Your account is active'), findsOneWidget);
    expect(find.text('Upgrade to Tier 2'), findsOneWidget);
    expect(find.text('1 of 2 verified'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
