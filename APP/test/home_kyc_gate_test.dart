import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/home_data_service.dart';

void main() {
  group('KycGatePolicy', () {
    test('allows non-debit funding before KYC verification', () {
      expect(KycGatePolicy.isBlocked(route: '/fund', status: 'PENDING'), false);
    });

    test('blocks debit and payout routes before KYC verification', () {
      expect(KycGatePolicy.isBlocked(route: '/send', status: 'PENDING'), true);
      expect(
          KycGatePolicy.isBlocked(route: '/withdraw', status: 'PENDING'), true);
      expect(
          KycGatePolicy.isBlocked(route: '/exchange', status: 'PENDING'), true);
      expect(
        KycGatePolicy.isBlocked(route: '/virtual-account', status: 'PENDING'),
        true,
      );
    });

    test('allows gated routes after KYC verification', () {
      expect(KycGatePolicy.isBlocked(route: '/withdraw', status: 'VERIFIED'),
          false);
    });
  });
}
