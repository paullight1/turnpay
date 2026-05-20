export type MoneyAttemptScope = "fund" | "withdraw" | "exchange" | "vtu" | "mutation";

function randomUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) => {
    const randomValue = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(char) / 4))
      : Math.floor(Math.random() * 16);
    return (Number(char) ^ randomValue).toString(16);
  });
}

export function createMoneyAttemptIdempotencyKey(scope: MoneyAttemptScope) {
  return `${scope}:${randomUuid()}`;
}

export function withIdempotencyKey(idempotencyKey?: string) {
  return idempotencyKey
    ? { headers: { "Idempotency-Key": idempotencyKey } }
    : undefined;
}
