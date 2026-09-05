/// An exact, two-decimal monetary value.
///
/// Money received from the API is kept as decimal text and represented as
/// integer minor units.  The [toDouble] conversion exists only as a
/// compatibility bridge for legacy chart/layout code; it must not be used for
/// financial decisions or for constructing request amounts.
class MoneyValue {
  static const int minorUnitsPerMajorUnit = 100;

  /// Accepts a signed decimal with no more than two fractional digits.
  ///
  /// Whitespace, exponent notation, a trailing decimal point, and additional
  /// fractional digits are rejected.  Leading zeroes are accepted so that
  /// values emitted by older API versions remain readable, while the exposed
  /// [decimalString] is always canonical.
  static final RegExp _decimalPattern = RegExp(
    r'^[+-]?0*[0-9]+(?:\.[0-9]{1,2})?$',
  );

  /// Creates a value from integer minor units.
  const MoneyValue.fromMinorUnits(
    this.minorUnits, {
    this.currency,
  });

  /// Parses an exact two-decimal monetary string.
  factory MoneyValue.parse(String input, {String? currency}) {
    if (!_decimalPattern.hasMatch(input)) {
      throw FormatException(
        'Invalid monetary value: expected a signed decimal with at most '
        'two fractional digits.',
        input,
      );
    }

    var digits = input;
    var negative = false;
    if (digits.startsWith('+') || digits.startsWith('-')) {
      negative = digits.startsWith('-');
      digits = digits.substring(1);
    }

    final parts = digits.split('.');
    final whole = parts.first;
    final fraction = parts.length == 2 ? parts[1] : '';
    final paddedFraction = fraction.padRight(2, '0');
    var minorUnits = BigInt.parse(whole) * BigInt.from(minorUnitsPerMajorUnit);
    minorUnits += BigInt.parse(paddedFraction);

    if (negative && minorUnits != BigInt.zero) {
      minorUnits = -minorUnits;
    }

    return MoneyValue.fromMinorUnits(
      minorUnits,
      currency: _normalizeCurrency(currency),
    );
  }

  /// Parses a JSON monetary value while retaining compatibility with API
  /// responses that still encode Decimal values as JSON numbers.
  ///
  /// The public [parse] method intentionally accepts strings only.  Numeric
  /// values are converted through their Dart decimal spelling and still pass
  /// the same strict format validation; malformed, non-finite, or missing
  /// values throw instead of silently becoming zero.
  factory MoneyValue.fromJson(dynamic value, {String? currency}) {
    if (value is MoneyValue) {
      if (currency == null || value.currency == _normalizeCurrency(currency)) {
        return value;
      }
      return value.withCurrency(currency);
    }

    if (value is String) {
      return MoneyValue.parse(value, currency: currency);
    }

    if (value is int) {
      return MoneyValue.parse(value.toString(), currency: currency);
    }

    if (value is double) {
      if (!value.isFinite) {
        throw const FormatException(
          'Invalid monetary value: number is not finite.',
        );
      }
      return MoneyValue.parse(value.toString(), currency: currency);
    }

    if (value is num) {
      return MoneyValue.parse(value.toString(), currency: currency);
    }

    throw FormatException(
      'Invalid monetary value: expected a decimal string.',
      value,
    );
  }

  final BigInt minorUnits;
  final String? currency;

  /// Canonical signed decimal representation with exactly two fractional
  /// digits.  Negative zero is normalized to `0.00`.
  String get decimalString {
    final negative = minorUnits.isNegative;
    final absolute = minorUnits.abs();
    final major = absolute ~/ BigInt.from(minorUnitsPerMajorUnit);
    final minor = (absolute % BigInt.from(minorUnitsPerMajorUnit))
        .toString()
        .padLeft(2, '0');
    return '${negative ? '-' : ''}$major.$minor';
  }

  bool get isNegative => minorUnits.isNegative;
  bool get isZero => minorUnits == BigInt.zero;
  bool get isPositive => minorUnits > BigInt.zero;

  /// Returns this value with an explicit positive-money invariant.
  MoneyValue requirePositive({String fieldName = 'amount'}) {
    if (!isPositive) {
      throw FormatException('$fieldName must be greater than zero.');
    }
    return this;
  }

  /// Compatibility conversion for charts and existing widgets only.
  double toDouble() => double.parse(decimalString);

  MoneyValue withCurrency(String? nextCurrency) {
    return MoneyValue.fromMinorUnits(
      minorUnits,
      currency: _normalizeCurrency(nextCurrency),
    );
  }

  MoneyValue operator +(MoneyValue other) {
    _assertSameCurrency(other);
    return MoneyValue.fromMinorUnits(
      minorUnits + other.minorUnits,
      currency: currency,
    );
  }

  MoneyValue operator -(MoneyValue other) {
    _assertSameCurrency(other);
    return MoneyValue.fromMinorUnits(
      minorUnits - other.minorUnits,
      currency: currency,
    );
  }

  MoneyValue operator -() {
    return MoneyValue.fromMinorUnits(-minorUnits, currency: currency);
  }

  MoneyValue abs() {
    return MoneyValue.fromMinorUnits(minorUnits.abs(), currency: currency);
  }

  int compareTo(MoneyValue other) {
    _assertSameCurrency(other);
    return minorUnits.compareTo(other.minorUnits);
  }

  void _assertSameCurrency(MoneyValue other) {
    if (currency == null ||
        other.currency == null ||
        currency == other.currency) {
      return;
    }
    throw MoneyCurrencyMismatchException(currency!, other.currency!);
  }

  static String? _normalizeCurrency(String? value) {
    if (value == null) return null;
    final normalized = value.trim().toUpperCase();
    return normalized.isEmpty ? null : normalized;
  }

  @override
  bool operator ==(Object other) {
    return other is MoneyValue &&
        other.minorUnits == minorUnits &&
        other.currency == currency;
  }

  @override
  int get hashCode => Object.hash(minorUnits, currency);

  @override
  String toString() => decimalString;
}

/// Raised when arithmetic would combine values from different currencies.
class MoneyCurrencyMismatchException extends ArgumentError {
  MoneyCurrencyMismatchException(this.expectedCurrency, this.actualCurrency)
      : super(
          'Cannot combine $expectedCurrency and $actualCurrency monetary '
          'values.',
        );

  final String expectedCurrency;
  final String actualCurrency;
}
