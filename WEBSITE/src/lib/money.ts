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
