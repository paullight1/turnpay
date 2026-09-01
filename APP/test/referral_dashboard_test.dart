import 'package:flutter_test/flutter_test.dart';

import 'support/trustpay_test_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    setMockSecureStorage(refreshToken: 'refresh-token');
  });

  test('referral dashboard returns invite totals and history', () async {
    final bundle = buildTrustPayTestBundle();

    final dashboard = await bundle.homeDataService.fetchReferralDashboard();

    expect(dashboard.code, 'TRUST-AB12');
    expect(dashboard.rewardAmount, 100);
    expect(dashboard.rewardCurrency, 'NGN');
    expect(dashboard.invites, 3);
    expect(dashboard.pendingAmount, 100);
    expect(dashboard.paidAmount, 200);
    expect(dashboard.referrals, hasLength(1));
    expect(dashboard.referrals.first.referredName, 'Grace Hopper');
    expect(dashboard.referrals.first.status, 'PAID');
  });

  test('referral dashboard supports an empty history', () async {
    final bundle = buildTrustPayTestBundle(includeReferralRewards: false);

    final dashboard = await bundle.homeDataService.fetchReferralDashboard();

    expect(dashboard.referrals, isEmpty);
    expect(dashboard.pendingAmount, 0);
    expect(dashboard.paidAmount, 0);
  });
}
