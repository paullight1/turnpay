import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';

/** Stable business identity survives generic replay expiry and process crashes.
 * The transaction reference's unique index is claimed in the debit transaction.
 * Authorization secrets are verified separately and are never fingerprinted.
 */
export function financialRequestIdentity(
  operation: 'WITHDRAW' | 'VTU',
  userId: string,
  key: string,
  businessRequest: Record<string, unknown>,
) {
  if (
    typeof key !== 'string' ||
    !key.trim() ||
    key.length > 200 ||
    /[\r\n]/.test(key)
  ) {
    throw new BadRequestException(
      'A valid Idempotency-Key (1–200 characters) is required',
    );
  }
  const referenceHash = createHash('sha256')
    .update(JSON.stringify(['financial-request-v1', operation, userId, key]))
    .digest('hex')
    .slice(0, 40);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(businessRequestFingerprint(businessRequest)))
    .digest('hex');
  return {
    reference: `${operation === 'WITHDRAW' ? 'wd' : 'VTU'}-${referenceHash}`,
    fingerprint,
  };
}

export function businessRequestFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(businessRequestFingerprint);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(
          ([key, child]) => key !== 'transactionPin' && child !== undefined,
        )
        .map(([key, child]) => [key, businessRequestFingerprint(child)]),
    );
  }
  return value;
}

export function assertFinancialRequestMatch(
  metadata: unknown,
  fingerprint: string,
) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    (metadata as Record<string, unknown>).requestFingerprint !== fingerprint
  ) {
    throw new ConflictException(
      'Idempotency-Key was already used for a different financial request',
    );
  }
}
