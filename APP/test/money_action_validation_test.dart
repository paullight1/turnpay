import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:trustpay_app/features/home/screens/money_action_screen.dart';

void main() {
  group('MoneyActionFormValidator', () {
    test('normalizes valid decimal amounts to two decimal string payloads', () {
      final result = MoneyActionFormValidator.validateAmount('1000.5');

      expect(result.value, '1000.50');
      expect(result.error, isNull);
    });

    test('accepts display amounts with thousands separators', () {
      final result = MoneyActionFormValidator.validateAmount('1,000,000.5');

      expect(result.value, '1000000.50');
      expect(result.error, isNull);
    });

    test('rejects invalid raw amount input', () {
      final result = MoneyActionFormValidator.validateAmount('10.999');

      expect(result.value, isNull);
      expect(result.error, 'Enter an amount with up to 2 decimal places.');
    });

    test('formats exchange amounts without losing the decimal portion', () {
      final formatter = ThousandsSeparatorInputFormatter();
      final formatted = formatter.formatEditUpdate(
        TextEditingValue.empty,
        const TextEditingValue(
          text: '1000000.50',
          selection: TextSelection.collapsed(offset: 10),
        ),
      );

      expect(formatted.text, '1,000,000.50');
    });

    test('describes exchange amounts in words', () {
      expect(
        exchangeAmountInWords('1,200,000', 'NGN'),
        'One million, two hundred thousand naira',
      );
      expect(
        exchangeAmountInWords('2500.50', 'GHS'),
        'Two thousand, five hundred cedis and fifty pesewas',
      );
      expect(exchangeAmountInWords('0', 'NGN'), isNull);
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

      expect(error, 'Choose a bank and enter a valid 10-digit account number.');
    });

    test('accepts a transfer note of exactly 120 Unicode code points', () {
      final error = MoneyActionFormValidator.validateFields(
        kind: MoneyActionKind.send,
        recipient: 'recipient@example.com',
        note: List.filled(120, '💚').join(),
      );

      expect(error, isNull);
    });

    test('rejects a transfer note of 121 Unicode code points', () {
      final error = MoneyActionFormValidator.validateFields(
        kind: MoneyActionKind.send,
        recipient: 'recipient@example.com',
        note: List.filled(121, '💚').join(),
      );

      expect(error, 'Keep the note to 120 characters or fewer.');
    });
  });
}
