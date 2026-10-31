import 'package:flutter/services.dart';

import 'package:trustpay_app/core/money/money_value.dart';

const int _maxAmountWordsInputChars = 18;
const int _maxAmountWordsMajorDigits = 15;

final RegExp _ungroupedAmountPattern = RegExp(r'^\d+(?:\.\d{0,2})?$');
final RegExp _groupedAmountPattern =
    RegExp(r'^\d{1,3}(?:,\d{3})+(?:\.\d{0,2})?$');

const Map<String, _CurrencyWords> _currencyWords = {
  'NGN': _CurrencyWords(
    majorSingular: 'naira',
    majorPlural: 'naira',
    minorSingular: 'kobo',
    minorPlural: 'kobo',
  ),
  'GHS': _CurrencyWords(
    majorSingular: 'cedi',
    majorPlural: 'cedis',
    minorSingular: 'pesewa',
    minorPlural: 'pesewas',
  ),
};

/// Returns an exact English description for a positive NGN or GHS amount.
///
/// The input is intentionally kept as text all the way through parsing. This
/// prevents large amounts from passing through a `double` or a platform-sized
/// `int`, and lets a partially entered trailing decimal (`1.`) be rendered
/// while the user is typing. Amounts are limited to 15 major-unit digits and
/// two fractional digits.
String? moneyAmountInWords(String rawAmount, String currency) {
  final currencyCode = currency.trim().toUpperCase();
  final units = _currencyWords[currencyCode];
  if (units == null) return null;

  final canonicalAmount = _canonicalAmount(rawAmount.trim());
  if (canonicalAmount == null) return null;

  late final MoneyValue value;
  try {
    value = MoneyValue.parse(canonicalAmount, currency: currencyCode);
  } on FormatException {
    return null;
  }

  if (!value.isPositive) return null;

  final absoluteMinorUnits = value.minorUnits;
  final majorUnits =
      absoluteMinorUnits ~/ BigInt.from(MoneyValue.minorUnitsPerMajorUnit);
  final minorUnits =
      absoluteMinorUnits % BigInt.from(MoneyValue.minorUnitsPerMajorUnit);
  final majorWords = _integerToWords(majorUnits);
  if (majorWords == null) return null;

  final majorUnit =
      majorUnits == BigInt.one ? units.majorSingular : units.majorPlural;
  final result = StringBuffer(_capitalize(majorWords))
    ..write(' ')
    ..write(majorUnit);

  if (minorUnits != BigInt.zero) {
    final minorWords = _integerToWords(minorUnits);
    if (minorWords == null) return null;
    final minorUnit =
        minorUnits == BigInt.one ? units.minorSingular : units.minorPlural;
    result
      ..write(' and ')
      ..write(minorWords)
      ..write(' ')
      ..write(minorUnit);
  }

  return result.toString();
}

/// Adds thousands separators to an amount while retaining an optional
/// decimal portion. Invalid punctuation is rejected by returning the prior
/// edit, rather than silently stripping characters and changing the amount.
class MoneyAmountInputFormatter extends TextInputFormatter {
  static const int _maxMajorDigits = 10;

  const MoneyAmountInputFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final sourceInput = newValue.text;
    if (sourceInput.isEmpty) {
      return newValue.copyWith(composing: TextRange.empty);
    }

    var input = sourceInput;
    if (!_isValidShape(input)) {
      input = _recoverSingleCharacterEdit(oldValue.text, input) ?? '';
      if (input.isEmpty) return oldValue;
    }

    final decimalIndex = input.indexOf('.');
    final integerPart =
        decimalIndex == -1 ? input : input.substring(0, decimalIndex);
    final fractionPart =
        decimalIndex == -1 ? '' : input.substring(decimalIndex + 1);
    final majorDigits = integerPart.replaceAll(',', '');
    if (majorDigits.length > _maxMajorDigits || fractionPart.length > 2) {
      return oldValue;
    }

    final normalizedMajorDigits = _stripLeadingZeroes(majorDigits);
    final groupedInteger = _groupDigits(normalizedMajorDigits);
    final formatted =
        decimalIndex == -1 ? groupedInteger : '$groupedInteger.$fractionPart';
    final caretOffset = _formattedCaretOffset(
      input: sourceInput,
      baseOffset: newValue.selection.baseOffset,
      formatted: formatted,
      normalizedMajorDigits: normalizedMajorDigits,
    );

    return newValue.copyWith(
      text: formatted,
      selection: TextSelection.collapsed(offset: caretOffset),
      composing: TextRange.empty,
    );
  }

  static bool _isValidShape(String value) {
    if (value.contains(',')) {
      return _groupedAmountPattern.hasMatch(value);
    }
    return _ungroupedAmountPattern.hasMatch(value);
  }

  /// A formatter emits grouped text after every edit. Therefore a normal
  /// single-digit edit can briefly produce a string such as `1,0000` or
  /// `10,00` before it is regrouped. Recover only that narrow transition;
  /// multi-character edits and inserted punctuation remain rejected.
  static String? _recoverSingleCharacterEdit(String oldValue, String value) {
    if (oldValue.isEmpty || !_isValidShape(oldValue)) return null;

    final edit = _singleCharacterEdit(oldValue, value);
    if (edit == null) return null;
    if (edit.inserted.isNotEmpty && !RegExp(r'^\d$').hasMatch(edit.inserted)) {
      return null;
    }

    final ungrouped = value.replaceAll(',', '');
    return _ungroupedAmountPattern.hasMatch(ungrouped) ? ungrouped : null;
  }

  static _SingleCharacterEdit? _singleCharacterEdit(
    String oldValue,
    String value,
  ) {
    var prefixLength = 0;
    final shortestLength =
        oldValue.length < value.length ? oldValue.length : value.length;
    while (prefixLength < shortestLength &&
        oldValue.codeUnitAt(prefixLength) == value.codeUnitAt(prefixLength)) {
      prefixLength++;
    }

    var oldSuffixLength = oldValue.length;
    var valueSuffixLength = value.length;
    while (oldSuffixLength > prefixLength &&
        valueSuffixLength > prefixLength &&
        oldValue.codeUnitAt(oldSuffixLength - 1) ==
            value.codeUnitAt(valueSuffixLength - 1)) {
      oldSuffixLength--;
      valueSuffixLength--;
    }

    final removed = oldValue.substring(prefixLength, oldSuffixLength);
    final inserted = value.substring(prefixLength, valueSuffixLength);
    if (removed.length > 1 || inserted.length > 1) return null;
    if (removed.isEmpty && inserted.isEmpty) return null;
    return _SingleCharacterEdit(removed: removed, inserted: inserted);
  }

  static String _stripLeadingZeroes(String value) {
    final normalized = value.replaceFirst(RegExp(r'^0+(?=\d)'), '');
    return normalized.isEmpty ? '0' : normalized;
  }

  static String _groupDigits(String value) {
    if (value.length <= 3) return value;

    final firstGroupLength = value.length % 3 == 0 ? 3 : value.length % 3;
    final groups = <String>[value.substring(0, firstGroupLength)];
    for (var index = firstGroupLength; index < value.length; index += 3) {
      groups.add(value.substring(index, index + 3));
    }
    return groups.join(',');
  }

  static int _formattedCaretOffset({
    required String input,
    required int baseOffset,
    required String formatted,
    required String normalizedMajorDigits,
  }) {
    final safeOffset = baseOffset.clamp(0, input.length);
    final beforeCaret = input.substring(0, safeOffset);
    final decimalBeforeCaret = beforeCaret.indexOf('.');
    final integerBeforeCaret = decimalBeforeCaret == -1
        ? beforeCaret
        : beforeCaret.substring(0, decimalBeforeCaret);
    final digitsBeforeCaret = integerBeforeCaret.replaceAll(',', '').length;
    final decimalInInput = input.indexOf('.');
    final leadingZeroesRemoved = input
            .substring(
              0,
              decimalInInput == -1 ? input.length : decimalInInput,
            )
            .replaceAll(',', '')
            .length -
        normalizedMajorDigits.length;
    final normalizedDigitsBeforeCaret =
        (digitsBeforeCaret - leadingZeroesRemoved)
            .clamp(0, normalizedMajorDigits.length);

    if (decimalBeforeCaret == -1) {
      return _offsetAfterDigits(formatted, normalizedDigitsBeforeCaret);
    }

    final decimalInFormatted = formatted.indexOf('.');
    final fractionBeforeCaret =
        beforeCaret.substring(decimalBeforeCaret + 1).length;
    return (decimalInFormatted + 1 + fractionBeforeCaret)
        .clamp(0, formatted.length);
  }

  static int _offsetAfterDigits(String formatted, int digitOffset) {
    if (digitOffset == 0) return 0;

    var digitsSeen = 0;
    for (var index = 0; index < formatted.length; index++) {
      if (formatted[index] == ',') continue;
      digitsSeen++;
      if (digitsSeen == digitOffset) return index + 1;
    }
    return formatted.length;
  }
}

String? _canonicalAmount(String value) {
  if (value.isEmpty || value.length > _maxAmountWordsInputChars) {
    return null;
  }

  final decimalIndex = value.indexOf('.');
  final integerPart =
      decimalIndex == -1 ? value : value.substring(0, decimalIndex);
  if (integerPart.isEmpty) return null;

  final isValid = value.contains(',')
      ? _groupedAmountPattern.hasMatch(value)
      : _ungroupedAmountPattern.hasMatch(value);
  if (!isValid) return null;

  final fractionPart =
      decimalIndex == -1 ? '' : value.substring(decimalIndex + 1);
  final majorDigits = integerPart.replaceAll(',', '');
  if (majorDigits.length > _maxAmountWordsMajorDigits ||
      fractionPart.length > 2) {
    return null;
  }

  final canonical =
      fractionPart.isEmpty ? majorDigits : '$majorDigits.$fractionPart';
  return canonical.length <= _maxAmountWordsInputChars ? canonical : null;
}

String? _integerToWords(BigInt value) {
  if (value.isNegative) return null;
  if (value == BigInt.zero) return 'zero';

  const scales = ['', 'thousand', 'million', 'billion', 'trillion'];
  final groups = <String>[];
  var remaining = value;
  var scaleIndex = 0;
  while (remaining > BigInt.zero) {
    final group = (remaining % BigInt.from(1000)).toInt();
    if (group > 0) {
      if (scaleIndex >= scales.length) return null;
      final groupWords = _underThousandToWords(group);
      groups.insert(
        0,
        scaleIndex == 0 ? groupWords : '$groupWords ${scales[scaleIndex]}',
      );
    }
    remaining ~/= BigInt.from(1000);
    scaleIndex++;
  }
  return groups.join(', ');
}

String _underThousandToWords(int value) {
  const ones = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
  ];

  if (value < 20) return ones[value];
  if (value < 100) {
    return value % 10 == 0
        ? tens[value ~/ 10]
        : '${tens[value ~/ 10]}-${ones[value % 10]}';
  }

  final remainder = value % 100;
  final suffix =
      remainder == 0 ? '' : ' and ${_underThousandToWords(remainder)}';
  return '${ones[value ~/ 100]} hundred$suffix';
}

String _capitalize(String value) {
  if (value.isEmpty) return value;
  return '${value[0].toUpperCase()}${value.substring(1)}';
}

class _CurrencyWords {
  final String majorSingular;
  final String majorPlural;
  final String minorSingular;
  final String minorPlural;

  const _CurrencyWords({
    required this.majorSingular,
    required this.majorPlural,
    required this.minorSingular,
    required this.minorPlural,
  });
}

class _SingleCharacterEdit {
  final String removed;
  final String inserted;

  const _SingleCharacterEdit({required this.removed, required this.inserted});
}
