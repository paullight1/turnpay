import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/money/money_value.dart';

void main() {
  group('MoneyValue', () {
    test('keeps exact minor units and canonical decimal strings', () {
      expect(
        MoneyValue.parse('9999999999999.99').decimalString,
        '9999999999999.99',
      );
      expect(MoneyValue.parse('0.10').decimalString, '0.10');
      expect(MoneyValue.parse('+12.5').decimalString, '12.50');
      expect(MoneyValue.parse('-12.50').minorUnits, BigInt.from(-1250));
      expect(MoneyValue.parse('0001.2').decimalString, '1.20');
      expect(MoneyValue.parse('0').decimalString, '0.00');
      expect(MoneyValue.parse('-0.00').decimalString, '0.00');
    });

    test('rejects malformed or over-precise money strings', () {
      for (final input in [
        'not-money',
        '',
        ' 1.00',
        '1.00 ',
        '1.001',
        '1.',
        '.10',
        '1e2',
        '--1.00',
        '+-1.00',
      ]) {
        expect(
          () => MoneyValue.parse(input),
          throwsFormatException,
          reason: 'Expected $input to be rejected',
        );
      }
    });

    test('keeps currency arithmetic safe', () {
      final naira = MoneyValue.parse('10.10', currency: 'ngn');
      final moreNaira = MoneyValue.parse('0.90', currency: 'NGN');
      final cedi = MoneyValue.parse('1.00', currency: 'GHS');

      expect((naira + moreNaira).decimalString, '11.00');
      expect((naira - moreNaira).decimalString, '9.20');
      expect(
        () => naira + cedi,
        throwsA(isA<MoneyCurrencyMismatchException>()),
      );
    });

    test('requires positive values for amount input', () {
      expect(MoneyValue.parse('0.01').requirePositive().decimalString, '0.01');
      expect(() => MoneyValue.parse('0.00').requirePositive(),
          throwsFormatException);
      expect(() => MoneyValue.parse('-0.01').requirePositive(),
          throwsFormatException);
    });

    test('accepts legacy JSON numbers only through the compatibility parser',
        () {
      expect(MoneyValue.fromJson(12.5).decimalString, '12.50');
      expect(MoneyValue.fromJson(12).minorUnits, BigInt.from(1200));
      expect(
        () => MoneyValue.fromJson(double.infinity),
        throwsFormatException,
      );
      expect(() => MoneyValue.fromJson(null), throwsFormatException);
    });
  });
}
