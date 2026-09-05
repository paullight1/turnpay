export type MoneyAttemptScope =
  | "fund"
  | "withdraw"
  | "exchange"
  | "vtu"
  | "vtu-validate"
  | "vtu-requery"
  | "vtu-pricing"
  | "transfer-reversal"
  | "reversal-approve"
  | "reversal-reject"
  | "internal-transfer"
  | "transaction-pin-setup"
  | "mutation";

function randomUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) => {
    const randomValue = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint8Array(1))[0] &
        (15 >> (Number(char) / 4))
      : Math.floor(Math.random() * 16);
    return (Number(char) ^ randomValue).toString(16);
  });
}

export function createMoneyAttemptIdempotencyKey(scope: MoneyAttemptScope) {
  return `${scope}:${randomUuid()}`;
}

/**
 * Manual exchange's backend validates keys as URL/header-safe identifier
 * characters and intentionally does not accept the shared helper's colon.
 */
export function createManualExchangeIdempotencyKey() {
  return `manual-exchange-${randomUuid()}`;
}

export function withIdempotencyKey(idempotencyKey?: string) {
  return idempotencyKey
    ? { headers: { "Idempotency-Key": idempotencyKey } }
    : undefined;
}
