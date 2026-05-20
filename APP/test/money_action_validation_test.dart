import 'package:flutter_test/flutter_test.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';

void main() {
  group('MoneyActionFormValidator', () {
    test('normalizes valid decimal amounts to two decimal string payloads', () {
      final result = MoneyActionFormValidator.validateAmount('1000.5');

      expect(result.value, '1000.50');
      expect(result.error, isNull);
    });

    test('rejects invalid raw amount input', () {
      final result = MoneyActionFormValidator.validateAmount('10.999');

      expect(result.value, isNull);
      expect(result.error, 'Enter an amount with up to 2 decimal places.');
    });

    test('requires send recipient email before submission', () {
      final error = MoneyActionFormValidator.validateFields(
        kind: MoneyActionKind.send,
        recipient: 'not-an-email',
      );

      expect(error, 'Enter a valid recipient email.');
    });

    test('requires withdrawal account fields before submission', () {
      final error = MoneyActionFormValidator.validateFields(
        kind: MoneyActionKind.withdraw,
        accountNumber: '123',
        accountName: 'Ada',
        bankCode: '',
      );

      expect(error, 'Enter a valid bank code and account number.');
    });
  });
}
