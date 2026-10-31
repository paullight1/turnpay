import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:trustpay_app/core/money/amount_words.dart';

void main() {
  group('moneyAmountInWords', () {
    test('describes exact naira amounts', () {
      expect(moneyAmountInWords('1,000', 'NGN'), 'One thousand naira');
      expect(
        moneyAmountInWords('1,000.50', 'NGN'),
        'One thousand naira and fifty kobo',
      );
      expect(
        moneyAmountInWords('1,200,000', 'NGN'),
        'One million, two hundred thousand naira',
      );
      expect(
        moneyAmountInWords('1250.50', 'NGN'),
        'One thousand, two hundred and fifty naira and fifty kobo',
      );
    });

    test('uses singular cedi and pesewa for one unit', () {
      expect(
        moneyAmountInWords('1.01', 'GHS'),
        'One cedi and one pesewa',
      );
      expect(
        moneyAmountInWords('2.02', 'GHS'),
        'Two cedis and two pesewas',
      );
    });

    test('accepts a trailing decimal while the amount is being typed', () {
      expect(moneyAmountInWords('1.', 'NGN'), 'One naira');
      expect(moneyAmountInWords('1,000.', 'NGN'), 'One thousand naira');
    });

    test('uses exact values for large supported amounts', () {
      expect(
        moneyAmountInWords('999999999999999.99', 'NGN'),
        'Nine hundred and ninety-nine trillion, nine hundred and ninety-nine '
        'billion, nine hundred and ninety-nine million, nine hundred and '
        'ninety-nine thousand, nine hundred and ninety-nine naira and '
        'ninety-nine kobo',
      );
    });

    test('returns null for unsupported or malformed amounts', () {
      for (final input in [
        '',
        '0',
        '0.00',
        '-1',
        '+1',
        '1,00',
        '1000,000',
        '1,000,00',
        '1.234',
        '1..0',
        '.50',
        '1e2',
        '1 000',
      ]) {
        expect(
          moneyAmountInWords(input, 'NGN'),
          isNull,
          reason: 'Expected $input to be rejected',
        );
      }
      expect(moneyAmountInWords('1.00', 'USD'), isNull);
      expect(moneyAmountInWords('1234567890123456.00', 'NGN'), isNull);
    });
  });

  group('MoneyAmountInputFormatter', () {
    const formatter = MoneyAmountInputFormatter();

    test('groups an unformatted pasted amount and keeps the caret at the end',
        () {
      final result = formatter.formatEditUpdate(
        TextEditingValue.empty,
        const TextEditingValue(
          text: '1000000.50',
          selection: TextSelection.collapsed(offset: 10),
        ),
      );

      expect(result.text, '1,000,000.50');
      expect(result.selection.baseOffset, result.text.length);
    });

    test('accepts valid grouped pasted thousands', () {
      final result = formatter.formatEditUpdate(
        TextEditingValue.empty,
        const TextEditingValue(
          text: '1,000,000.50',
          selection: TextSelection.collapsed(offset: 12),
        ),
      );

      expect(result.text, '1,000,000.50');
    });

    test('preserves the logical caret when commas are inserted', () {
      final result = formatter.formatEditUpdate(
        const TextEditingValue(
          text: '1,000',
          selection: TextSelection.collapsed(offset: 5),
        ),
        const TextEditingValue(
          text: '10,000',
          selection: TextSelection.collapsed(offset: 2),
        ),
      );

      expect(result.text, '10,000');
      expect(result.selection.baseOffset, 2);
    });

    test('allows incremental growth through grouped values', () {
      var value = formatter.formatEditUpdate(
        TextEditingValue.empty,
        const TextEditingValue(
          text: '999',
          selection: TextSelection.collapsed(offset: 3),
        ),
      );
      expect(value.text, '999');

      value = formatter.formatEditUpdate(
        value,
        const TextEditingValue(
          text: '9999',
          selection: TextSelection.collapsed(offset: 4),
        ),
      );
      expect(value.text, '9,999');

      value = formatter.formatEditUpdate(
        value,
        const TextEditingValue(
          text: '9,9999',
          selection: TextSelection.collapsed(offset: 6),
        ),
      );
      expect(value.text, '99,999');
      expect(value.selection.baseOffset, value.text.length);
    });

    test('allows backspacing and editing inside grouped values', () {
      const oldValue = TextEditingValue(
        text: '10,000',
        selection: TextSelection.collapsed(offset: 6),
      );
      final afterBackspace = formatter.formatEditUpdate(
        oldValue,
        const TextEditingValue(
          text: '10,00',
          selection: TextSelection.collapsed(offset: 5),
        ),
      );
      expect(afterBackspace.text, '1,000');
      expect(afterBackspace.selection.baseOffset, 5);

      final afterMidNumberEdit = formatter.formatEditUpdate(
        const TextEditingValue(
          text: '9,999',
          selection: TextSelection.collapsed(offset: 2),
        ),
        const TextEditingValue(
          text: '9,0999',
          selection: TextSelection.collapsed(offset: 4),
        ),
      );
      expect(afterMidNumberEdit.text, '90,999');
      expect(afterMidNumberEdit.selection.baseOffset, 4);
    });

    test('allows empty and trailing-decimal values', () {
      expect(
        formatter
            .formatEditUpdate(
              const TextEditingValue(
                  text: '1', selection: TextSelection.collapsed(offset: 1)),
              const TextEditingValue(
                  text: '', selection: TextSelection.collapsed(offset: 0)),
            )
            .text,
        isEmpty,
      );
      expect(
        formatter
            .formatEditUpdate(
              TextEditingValue.empty,
              const TextEditingValue(
                  text: '1.', selection: TextSelection.collapsed(offset: 2)),
            )
            .text,
        '1.',
      );
    });

    test('rejects malformed punctuation instead of stripping it', () {
      const oldValue = TextEditingValue(
        text: '1,000',
        selection: TextSelection.collapsed(offset: 5),
      );

      for (final input in ['1,000,00', '1..00', '1,000.000']) {
        final result = formatter.formatEditUpdate(
          oldValue,
          TextEditingValue(
            text: input,
            selection: TextSelection.collapsed(offset: input.length),
          ),
        );
        expect(result, oldValue, reason: 'Expected $input to be rejected');
      }

      final insertedComma = formatter.formatEditUpdate(
        oldValue,
        const TextEditingValue(
          text: '1,,000',
          selection: TextSelection.collapsed(offset: 6),
        ),
      );
      expect(insertedComma, oldValue);
    });

    test('rejects more than two decimals or ten major digits', () {
      const oldValue = TextEditingValue(
        text: '1,000',
        selection: TextSelection.collapsed(offset: 5),
      );

      final tooManyDecimals = formatter.formatEditUpdate(
        oldValue,
        const TextEditingValue(
          text: '1,000.000',
          selection: TextSelection.collapsed(offset: 9),
        ),
      );
      final tooManyMajorDigits = formatter.formatEditUpdate(
        oldValue,
        const TextEditingValue(
          text: '10,000,000,000',
          selection: TextSelection.collapsed(offset: 14),
        ),
      );

      expect(tooManyDecimals, oldValue);
      expect(tooManyMajorDigits, oldValue);
    });
  });
}
