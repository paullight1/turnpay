import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/home_data_service.dart';

void main() {
  group('KycGatePolicy', () {
    test('allows non-debit funding before KYC verification', () {
      expect(
        KycGatePolicy.isBlocked(
          route: '/fund',
          status: 'PENDING',
          kycTier: 'TIER_0',
        ),
        false,
      );
    });

    test('allows the send chooser before KYC verification', () {
      expect(
        KycGatePolicy.isBlocked(
          route: '/send',
          status: 'PENDING',
          kycTier: 'TIER_0',
        ),
        false,
      );
    });

    test('blocks debit and payout leaf routes before KYC verification', () {
      expect(
        KycGatePolicy.isBlocked(
          route: '/send/trustpay',
          status: 'PENDING',
          kycTier: 'TIER_0',
        ),
        true,
      );
      expect(
        KycGatePolicy.isBlocked(
          route: '/send/bank',
          status: 'PENDING',
          kycTier: 'TIER_0',
        ),
        true,
      );
      expect(
        KycGatePolicy.isBlocked(
          route: '/withdraw',
          status: 'PENDING',
          kycTier: 'TIER_0',
        ),
        true,
      );
      expect(
        KycGatePolicy.isBlocked(
          route: '/exchange',
          status: 'PENDING',
          kycTier: 'TIER_0',
        ),
        true,
      );
      expect(
        KycGatePolicy.isBlocked(
          route: '/virtual-account',
          status: 'PENDING',
          kycTier: 'TIER_0',
        ),
        true,
      );
    });

    test('allows gated routes after KYC verification', () {
      expect(
        KycGatePolicy.isBlocked(
          route: '/withdraw',
          status: 'VERIFIED',
          kycTier: 'TIER_2',
        ),
        false,
      );
    });

    test('only reveals virtual account numbers after complete KYC', () {
      expect(
        KycGatePolicy.canRevealVirtualAccount(
          status: 'PENDING',
          kycTier: 'TIER_0',
        ),
        false,
      );
      expect(
        KycGatePolicy.canRevealVirtualAccount(
          status: 'VERIFIED',
          kycTier: 'TIER_1',
        ),
        false,
      );
      expect(
        KycGatePolicy.canRevealVirtualAccount(
          status: 'VERIFIED',
          kycTier: 'TIER_2',
        ),
        true,
      );
    });
  });
}
