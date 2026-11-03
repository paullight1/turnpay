/**
 * The unit in which an administrator enters a rate.
 *
 * Customer-facing exchange code always consumes a canonical multiplier in
 * target units per source unit. SOURCE_PER_TARGET preserves the older admin
 * input convention (for example, 87 NGN per 1 GHS) without persisting an
 * inverted four-decimal reciprocal.
 */
export const RATE_QUOTE_BASES = [
  'TARGET_PER_SOURCE',
  'SOURCE_PER_TARGET',
] as const;

export type RateQuoteBasis = (typeof RATE_QUOTE_BASES)[number];

export const DEFAULT_RATE_QUOTE_BASIS: RateQuoteBasis = 'TARGET_PER_SOURCE';
