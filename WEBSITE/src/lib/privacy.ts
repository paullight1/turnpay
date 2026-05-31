export type RedactedMetadataRow = {
  label: string;
  value: string;
};

const NOT_PROVIDED = "Not provided";

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function maskTail(value?: string | null, visible = 4) {
  if (!value) return NOT_PROVIDED;
  const normalized = value.trim();
  if (!normalized) return NOT_PROVIDED;
  if (normalized.length <= visible) return "*".repeat(normalized.length);
  return `${"*".repeat(normalized.length - visible)}${normalized.slice(-visible)}`;
}

export function maskKycId(value?: string | null) {
  return maskTail(value, 4);
}

export function maskAccountNumber(value?: string | null) {
  if (!value) return NOT_PROVIDED;
  const digits = onlyDigits(value);
  if (digits.length <= 4) return maskTail(digits, 2);
  if (digits.length <= 6) {
    return `${digits.slice(0, 1)}${"*".repeat(digits.length - 3)}${digits.slice(-2)}`;
  }
  return `${digits.slice(0, 2)}${"*".repeat(Math.max(4, digits.length - 6))}${digits.slice(-4)}`;
}

export function maskPhone(value?: string | null) {
  if (!value) return NOT_PROVIDED;
  const normalized = value.trim();
  if (!normalized) return NOT_PROVIDED;
  const hasPlus = normalized.startsWith("+");
  const digits = onlyDigits(normalized);
  if (digits.length <= 4) return maskTail(digits, 2);

  const prefixLength = hasPlus ? Math.min(3, Math.max(1, digits.length - 8)) : 3;
  const prefix = `${hasPlus ? "+" : ""}${digits.slice(0, prefixLength)}`;
  const suffix = digits.slice(-4);
  return `${prefix}${"*".repeat(Math.max(4, digits.length - prefixLength - 4))}${suffix}`;
}

export function maskEmail(value?: string | null) {
  if (!value) return NOT_PROVIDED;
  const normalized = value.trim();
  const [localPart, domain] = normalized.split("@");
  if (!localPart || !domain) return maskTail(normalized, 4);
  if (localPart.length === 1) return `*@${domain}`;
  if (localPart.length === 2) return `${localPart[0]}*@${domain}`;
  return `${localPart[0]}${"*".repeat(localPart.length - 2)}${localPart.slice(-1)}@${domain}`;
}

function formatMetadataValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return NOT_PROVIDED;
  const stringValue = String(value);

  if (key === "accountNumber" || key === "sourceAccountNumber" || key === "destinationAccountNumber") {
    return maskAccountNumber(stringValue);
  }

  if (key === "recipientNumber" || key === "phone" || key === "customerPhone") {
    return maskPhone(stringValue);
  }

  if (key === "email" || key === "customerEmail") {
    return maskEmail(stringValue);
  }

  if (key === "idNumber" || key === "bvn" || key === "nin") {
    return maskKycId(stringValue);
  }

  return stringValue;
}

const METADATA_LABELS: Record<string, string> = {
  accountName: "Account name",
  accountNumber: "Account number",
  bankName: "Bank",
  channel: "Channel",
  customerEmail: "Customer email",
  customerPhone: "Customer phone",
  destinationCurrency: "To currency",
  email: "Email",
  exchangeRate: "Exchange rate",
  from: "From currency",
  meterNumber: "Meter number",
  packageName: "Package",
  phone: "Phone",
  provider: "Provider",
  providerReference: "Provider reference",
  quoteId: "Quote",
  recipientNumber: "Recipient",
  smartCardNumber: "Smart card",
  sourceCurrency: "From currency",
  to: "To currency",
};

const METADATA_ALLOWLIST = [
  "provider",
  "channel",
  "providerReference",
  "quoteId",
  "from",
  "sourceCurrency",
  "to",
  "destinationCurrency",
  "exchangeRate",
  "bankName",
  "accountName",
  "accountNumber",
  "recipientNumber",
  "packageName",
  "smartCardNumber",
  "meterNumber",
  "customerEmail",
  "email",
  "customerPhone",
  "phone",
];

export function redactTransactionMetadata(metadata: unknown): RedactedMetadataRow[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const record = metadata as Record<string, unknown>;
  return METADATA_ALLOWLIST.flatMap((key) => {
    if (!(key in record)) return [];
    return [{ label: METADATA_LABELS[key], value: formatMetadataValue(key, record[key]) }];
  });
}
