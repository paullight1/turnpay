export type ApiDiagnosticInput = {
  path: string;
  headers?: Record<string, unknown>;
  body?: unknown;
};

export type SafeApiDiagnostic = {
  path: string;
  headers: Record<string, unknown>;
  body: unknown;
};

const REDACTED = "<redacted>";
const OMITTED = "<omitted:sensitive-endpoint>";
const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|idempotency-key|x-idempotency-key)$/i;
const SENSITIVE_KEY = /(password|token|secret|pin|otp|account(number)?|api[-_]?key|idempotency[-_]?key)/i;
const SENSITIVE_PATH = /^\/api\/(auth\/(?:login|register|refresh|otp|transaction-pin)|payments|transfers|exchange|kyc|vtu|banking\/accounts)/i;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactValue(nested),
    ]),
  );
}

export function redactApiDiagnostic(input: ApiDiagnosticInput): SafeApiDiagnostic {
  return {
    path: input.path,
    headers: Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([key, value]) => [
        key,
        SENSITIVE_HEADER.test(key) ? REDACTED : redactValue(value),
      ]),
    ),
    body: SENSITIVE_PATH.test(input.path) ? OMITTED : redactValue(input.body),
  };
}
