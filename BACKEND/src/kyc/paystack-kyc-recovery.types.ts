export type PaystackKycRecoveryState =
  | 'CHECKING'
  | 'AWAITING_PROVIDER'
  | 'ACTION_REQUIRED'
  | 'WEBHOOK_REQUESTED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'NO_PENDING';

export interface PaystackKycRecoveryView {
  state: PaystackKycRecoveryState;
  message: string;
  supportReference: string | null;
  pendingSince: string | null;
  checkedAt: string | null;
  retryAllowed: false;
}

/** The only JSON key written by the recovery service. */
export const PAYSTACK_RECOVERY_KEY = 'paystackRecovery' as const;

export type PaystackKycReplayStatus = 'RESERVED' | 'REQUESTED' | 'UNKNOWN';

/**
 * Provider-neutral, non-sensitive recovery facts. Never add the provider
 * payload, BVN, account number, customer object, or provider error text here.
 */
export interface PaystackKycRecoveryMetadata {
  state: PaystackKycRecoveryState;
  message: string;
  supportReference: string | null;
  pendingSince: string | null;
  checkedAt: string | null;
  leaseId?: string | null;
  leaseUntil?: string | null;
  cooldownUntil?: string | null;
  replayEventId?: string | null;
  replayEventType?:
    | 'customeridentification.success'
    | 'customeridentification.failed'
    | null;
  replayStatus?: PaystackKycReplayStatus | null;
  replayReservedAt?: string | null;
  replayRequestedAt?: string | null;
  customerIdentified?: boolean;
  eventHistoryComplete?: boolean;
}

export const PAYSTACK_RECOVERY_LEASE_MS = 30_000;
export const PAYSTACK_RECOVERY_COOLDOWN_MS = 60_000;
export const PAYSTACK_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PAYSTACK_RECOVERY_DEADLINE_MS = 20_000;
export const PAYSTACK_RECOVERY_PAGE_SIZE = 25;
export const PAYSTACK_RECOVERY_MAX_PAGES = 4;
export const PAYSTACK_RECOVERY_MAX_CANDIDATES = 50;

const MESSAGES: Record<PaystackKycRecoveryState, string> = {
  CHECKING: 'Your BVN verification status is being checked.',
  AWAITING_PROVIDER:
    'Paystack has not returned a final BVN result yet. Your verification remains pending.',
  ACTION_REQUIRED:
    'Your BVN verification needs support review before it can be completed.',
  WEBHOOK_REQUESTED:
    'A genuine Paystack verification result was found and securely requested again. Your signed result is still pending.',
  TEMPORARILY_UNAVAILABLE:
    'Paystack status is temporarily unavailable. Please check again later.',
  NO_PENDING: 'There is no pending Paystack BVN verification.',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asState(value: unknown): PaystackKycRecoveryState | null {
  return value === 'CHECKING' ||
    value === 'AWAITING_PROVIDER' ||
    value === 'ACTION_REQUIRED' ||
    value === 'WEBHOOK_REQUESTED' ||
    value === 'TEMPORARILY_UNAVAILABLE' ||
    value === 'NO_PENDING'
    ? value
    : null;
}

function isStale(pendingSince: string | null, state: PaystackKycRecoveryState) {
  // NO_PENDING is the only terminal projection. Every other state still has
  // no provider decision, so a pending attempt older than a day needs action.
  if (state === 'NO_PENDING' || state === 'ACTION_REQUIRED' || !pendingSince)
    return false;
  const pendingAt = Date.parse(pendingSince);
  return (
    Number.isFinite(pendingAt) &&
    Date.now() - pendingAt >= PAYSTACK_RECOVERY_MAX_AGE_MS
  );
}

/**
 * Project untrusted JSON checks into the exact customer-facing recovery view.
 * This helper deliberately drops every field not needed by the projection.
 */
export function toPaystackRecoveryView(
  documentId: string,
  pendingSince: Date | string | undefined,
  rawRecovery: unknown,
): PaystackKycRecoveryView {
  const outer = asRecord(rawRecovery);
  const recovery = asRecord(outer?.[PAYSTACK_RECOVERY_KEY]) ?? outer;
  const pendingSinceIso = asIso(pendingSince) ?? asIso(recovery?.pendingSince);
  const checkedAt = asIso(recovery?.checkedAt);
  const initialState = asState(recovery?.state) ?? 'AWAITING_PROVIDER';
  const state = isStale(pendingSinceIso, initialState)
    ? 'ACTION_REQUIRED'
    : initialState;
  // A support reference is an internal document handle, never a provider
  // customer code, email, event payload, or verification reference.
  const supportReference =
    state === 'NO_PENDING'
      ? null
      : documentId.trim()
        ? `KYC-${documentId.trim()}`
        : null;

  return {
    state,
    message: MESSAGES[state],
    supportReference,
    pendingSince: pendingSinceIso,
    checkedAt,
    retryAllowed: false,
  };
}

export function paystackRecoveryMessage(state: PaystackKycRecoveryState) {
  return MESSAGES[state];
}
