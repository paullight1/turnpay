import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/services/wallet_service.dart';

void main() {
  group('Paystack checkout destination', () {
    test('accepts a hosted Paystack checkout', () {
      final checkout = PaystackCheckout.fromJson({
        'reference': 'fund-fixture',
        'status': 'PENDING',
        'authorizationUrl': 'https://checkout.paystack.com/fixture',
      });
      expect(checkout.authorizationUrl?.host, 'checkout.paystack.com');
    });

    for (final url in [
      'http://checkout.paystack.com/fixture',
      'https://checkout.paystack.com.attacker.invalid/fixture',
      'https://attacker.invalid/checkout',
      'https://attacker@checkout.paystack.com/fixture',
      'https://checkout.paystack.com:444/fixture',
      'not a URL',
    ]) {
      test('rejects unsafe destination $url', () {
        expect(
          () => PaystackCheckout.fromJson({
            'reference': 'fund-fixture',
            'authorizationUrl': url,
          }),
          throwsFormatException,
        );
      });
    }

    test('keeps an uncertain initialization available for verification', () {
      final checkout = PaystackCheckout.fromJson({
        'reference': 'fund-fixture',
        'status': 'PENDING',
      });
      expect(checkout.authorizationUrl, isNull);
      expect(checkout.reference, 'fund-fixture');
      expect(checkout.status, 'PENDING');
    });
  });
}
