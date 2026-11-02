const DECIMAL_AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Convert a user-entered amount to the exact decimal string accepted by the
 * payments API. Avoid Number so cents are never changed by binary rounding.
 */
export function canonicalizeMoneyAmount(value: string) {
  const match = DECIMAL_AMOUNT_PATTERN.exec(value.trim());
  if (!match) return null;

  const whole = match[1].replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").padEnd(2, "0");

  if (whole.length > 10 || (whole === "0" && fraction === "00")) {
    return null;
  }

  return `${whole}.${fraction}`;
}

/** Display-only: the smallest two-decimal send amount covering one receive unit.
 * Round up to match the exchange quote's round-down receive policy. */
export function minimumSendForOneUnit(rate: string) {
  const match = /^(\d{1,6})(?:\.(\d{0,12}))?$/.exec(rate.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  const numerator = BigInt(match[1] + fraction);
  if (numerator <= BigInt(0)) return null;
  const denominator = BigInt(10) ** BigInt(fraction.length);
  const minor =
    (BigInt(100) * denominator + numerator - BigInt(1)) / numerator;
  return `${minor / BigInt(100)}.${(minor % BigInt(100)).toString().padStart(2, "0")}`;
}
