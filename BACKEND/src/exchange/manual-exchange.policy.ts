import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export const MANUAL_STATUSES = [
  'AWAITING_TRANSFER',
  'AWAITING_CONFIRMATION',
  'NEEDS_MORE_INFO',
  'REJECTED',
  'CREDITED',
  'PAYOUT_PENDING',
  'PAYOUT_PROCESSING',
  'PAYOUT_SENT',
  'COMPLETED',
] as const;
export const MANUAL_ACTIONS = [
  'CREDIT_WALLET',
  'CONFIRM_DEPOSIT',
  'REQUEST_INFO',
  'REJECT',
  'CLAIM_PAYOUT',
  'HANDOVER_PAYOUT',
  'MARK_SENT',
  'RECORD_CEDIS_SENT',
  'COMPLETE',
] as const;
export const MANUAL_PAYOUT_OUTCOMES = [
  'NOT_SENT',
  'CONFIRMED_FAILED',
  'ALREADY_SENT',
  'UNKNOWN',
] as const;
export type ManualAction = (typeof MANUAL_ACTIONS)[number];
export type ManualStatus = (typeof MANUAL_STATUSES)[number];
export type SettlementMode = 'WALLET' | 'BANK' | 'MOMO';
export type ManualPayoutOutcome = (typeof MANUAL_PAYOUT_OUTCOMES)[number];

/** New manual orders follow the approved delivery contract; old orders keep their stored mode. */
export function manualDeliveryOptions(source: 'NGN' | 'GHS'): SettlementMode[] {
  return source === 'GHS' ? ['WALLET'] : ['MOMO', 'BANK'];
}
export function assertManualDelivery(
  source: 'NGN' | 'GHS',
  mode: SettlementMode,
) {
  if (!manualDeliveryOptions(source).includes(mode))
    throw new BadRequestException(
      source === 'GHS'
        ? 'Cedis to naira is paid into your TrustPay naira wallet. Choose TrustPay wallet.'
        : 'Cedis are sent to a bank or MoMo account. Choose a receiving bank or mobile money.',
    );
}

export function nextManualExchangeStatus(
  status: string,
  mode: SettlementMode,
  action: ManualAction,
): ManualStatus {
  if (['AWAITING_CONFIRMATION', 'NEEDS_MORE_INFO'].includes(status)) {
    if (action === 'REQUEST_INFO') return 'NEEDS_MORE_INFO';
    if (action === 'REJECT') return 'REJECTED';
  }
  if (status === 'AWAITING_CONFIRMATION') {
    if (action === 'CREDIT_WALLET' && mode === 'WALLET') return 'CREDITED';
    if (action === 'CONFIRM_DEPOSIT' && mode !== 'WALLET')
      return 'PAYOUT_PENDING';
  }
  if (mode !== 'WALLET') {
    if (status === 'PAYOUT_PENDING' && action === 'CLAIM_PAYOUT')
      return 'PAYOUT_PROCESSING';
    if (status === 'PAYOUT_PROCESSING' && action === 'MARK_SENT')
      return 'PAYOUT_SENT';
    if (status === 'PAYOUT_PROCESSING' && action === 'RECORD_CEDIS_SENT')
      return 'COMPLETED';
    if (status === 'PAYOUT_SENT' && action === 'COMPLETE') return 'COMPLETED';
  }
  throw new ConflictException(
    'This action is not available for this exchange state and settlement choice',
  );
}

/**
 * A handover never starts a new order or releases a claim automatically. It
 * may only move an actively claimed external payout to another operator after
 * a supervisor has classified the real-world outcome. An unknown outcome is
 * deliberately not actionable: reassigning it could cause a duplicate send.
 */
export function nextManualPayoutHandoverStatus(
  status: string,
  mode: SettlementMode,
  outcome: ManualPayoutOutcome,
): ManualStatus {
  if (mode === 'WALLET' || status !== 'PAYOUT_PROCESSING')
    throw new ConflictException(
      'Only an actively claimed external payout can be handed over',
    );
  if (outcome === 'UNKNOWN')
    throw new ConflictException(
      'The external payout outcome is unknown. Do not reassign or send again; reconcile the original claim first',
    );
  return outcome === 'ALREADY_SENT' ? 'PAYOUT_SENT' : 'PAYOUT_PROCESSING';
}

export function quoteManualExchange(
  amountText: string,
  rateText: string,
  markupText: string,
) {
  if (!/^\d+(\.\d{1,2})?$/.test(amountText))
    throw new BadRequestException(
      'Enter a positive amount with up to two decimal places',
    );
  const amount = new Decimal(amountText);
  const baseRate = new Decimal(rateText);
  const markup = new Decimal(markupText);
  if (
    !amount.isFinite() ||
    amount.lte(0) ||
    amount.gt('10000000') ||
    !baseRate.isFinite() ||
    baseRate.lte(0) ||
    !markup.isFinite() ||
    markup.lt(0) ||
    markup.gte(100)
  )
    throw new BadRequestException('Amount or exchange rate is unavailable');
  // Same markup model as manual receipts; freeze precision before calculating.
  const rate = baseRate
    .mul(new Decimal(1).minus(markup.div(100)))
    .toDecimalPlaces(6, Decimal.ROUND_DOWN);
  const target = amount.mul(rate).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  if (target.lte(0))
    throw new BadRequestException('Amount is too small for this exchange');
  return {
    amount: amount.toFixed(2),
    rate: rate.toFixed(6),
    targetAmount: target.toFixed(2),
    fee: '0.00',
  };
}
