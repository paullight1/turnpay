export function maskAccountNumber(accountNumber: string): string {
  const normalized = accountNumber.replace(/\D/g, '');

  if (normalized.length <= 4) {
    return normalized;
  }

  return `${'*'.repeat(Math.max(normalized.length - 4, 0))}${normalized.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');

  if (!localPart || !domain) {
    return '';
  }

  return `${localPart.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string): string {
  const normalized = phone.replace(/\s/g, '');

  if (normalized.length <= 4) {
    return normalized;
  }

  return `${normalized.slice(0, 4)}***${normalized.slice(-2)}`;
}

export function redactProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactProviderPayload(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sensitiveKeys = new Set([
    'account_number',
    'accountNumber',
    'sender_bank_account_number',
    'receiver_bank_account_number',
    'bvn',
    'nin',
    'idNumber',
    'authorization',
    'signature',
    'secret',
    'token',
  ]);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (sensitiveKeys.has(key)) {
        return [key, '[REDACTED]'];
      }

      return [key, redactProviderPayload(entry)];
    }),
  );
}
