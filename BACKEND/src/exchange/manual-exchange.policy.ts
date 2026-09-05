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
  'MARK_SENT',
  'COMPLETE',
] as const;
export type ManualAction = (typeof MANUAL_ACTIONS)[number];
export type ManualStatus = (typeof MANUAL_STATUSES)[number];
export type SettlementMode = 'WALLET' | 'BANK' | 'MOMO';

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
    if (status === 'PAYOUT_SENT' && action === 'COMPLETE') return 'COMPLETED';
  }
  throw new ConflictException(
    'This action is not available for this exchange state and settlement choice',
  );
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
