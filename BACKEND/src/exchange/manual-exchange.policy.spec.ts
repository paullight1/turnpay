import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  nextManualExchangeStatus,
  nextManualPayoutHandoverStatus,
  quoteManualExchange,
  manualDeliveryOptions,
  assertManualDelivery,
} from './manual-exchange.policy';

describe('manual exchange policy', () => {
  it('matches the approved delivery method for each new direction', () => {
    expect(manualDeliveryOptions('GHS')).toEqual(['WALLET']);
    expect(manualDeliveryOptions('NGN')).toEqual(['MOMO', 'BANK']);
    expect(() => assertManualDelivery('GHS', 'BANK')).toThrow(
      BadRequestException,
    );
    expect(() => assertManualDelivery('NGN', 'WALLET')).toThrow(
      BadRequestException,
    );
    expect(() => assertManualDelivery('GHS', 'WALLET')).not.toThrow();
    expect(() => assertManualDelivery('NGN', 'MOMO')).not.toThrow();
  });
  it('credits only wallet orders and keeps external confirmation pending', () => {
    expect(
      nextManualExchangeStatus(
        'AWAITING_CONFIRMATION',
        'WALLET',
        'CREDIT_WALLET',
      ),
    ).toBe('CREDITED');
    expect(
      nextManualExchangeStatus(
        'AWAITING_CONFIRMATION',
        'MOMO',
        'CONFIRM_DEPOSIT',
      ),
    ).toBe('PAYOUT_PENDING');
    expect(() =>
      nextManualExchangeStatus(
        'AWAITING_CONFIRMATION',
        'MOMO',
        'CREDIT_WALLET',
      ),
    ).toThrow(ConflictException);
    expect(() =>
      nextManualExchangeStatus('CREDITED', 'WALLET', 'CLAIM_PAYOUT'),
    ).toThrow(ConflictException);
  });
  it('never completes on approval and does not reject a received deposit', () => {
    expect(
      nextManualExchangeStatus('PAYOUT_PENDING', 'BANK', 'CLAIM_PAYOUT'),
    ).toBe('PAYOUT_PROCESSING');
    expect(
      nextManualExchangeStatus('PAYOUT_PROCESSING', 'BANK', 'MARK_SENT'),
    ).toBe('PAYOUT_SENT');
    expect(nextManualExchangeStatus('PAYOUT_SENT', 'BANK', 'COMPLETE')).toBe(
      'COMPLETED',
    );
    expect(() =>
      nextManualExchangeStatus('PAYOUT_PENDING', 'BANK', 'COMPLETE'),
    ).toThrow(ConflictException);
    expect(() =>
      nextManualExchangeStatus('PAYOUT_PENDING', 'BANK', 'REJECT'),
    ).toThrow(ConflictException);
  });
  it('records a claimed manual cedi payout as complete, without completing an unclaimed order', () => {
    expect(
      nextManualExchangeStatus(
        'PAYOUT_PROCESSING',
        'MOMO',
        'RECORD_CEDIS_SENT',
      ),
    ).toBe('COMPLETED');
    expect(() =>
      nextManualExchangeStatus('PAYOUT_PENDING', 'MOMO', 'RECORD_CEDIS_SENT'),
    ).toThrow(ConflictException);
    expect(() =>
      nextManualExchangeStatus(
        'AWAITING_CONFIRMATION',
        'MOMO',
        'RECORD_CEDIS_SENT',
      ),
    ).toThrow(ConflictException);
    expect(() =>
      nextManualExchangeStatus('CREDITED', 'WALLET', 'RECORD_CEDIS_SENT'),
    ).toThrow(ConflictException);
  });
  it('only hands a claimed payout to another operator after a known external outcome', () => {
    expect(
      nextManualPayoutHandoverStatus('PAYOUT_PROCESSING', 'MOMO', 'NOT_SENT'),
    ).toBe('PAYOUT_PROCESSING');
    expect(
      nextManualPayoutHandoverStatus(
        'PAYOUT_PROCESSING',
        'BANK',
        'CONFIRMED_FAILED',
      ),
    ).toBe('PAYOUT_PROCESSING');
    expect(
      nextManualPayoutHandoverStatus(
        'PAYOUT_PROCESSING',
        'BANK',
        'ALREADY_SENT',
      ),
    ).toBe('PAYOUT_SENT');
    expect(() =>
      nextManualPayoutHandoverStatus('PAYOUT_PROCESSING', 'BANK', 'UNKNOWN'),
    ).toThrow(ConflictException);
    expect(() =>
      nextManualPayoutHandoverStatus('PAYOUT_PENDING', 'BANK', 'NOT_SENT'),
    ).toThrow(ConflictException);
    expect(() =>
      nextManualPayoutHandoverStatus('PAYOUT_PROCESSING', 'WALLET', 'NOT_SENT'),
    ).toThrow(ConflictException);
  });
  it('freezes exact amounts with existing rate markup and zero extra receipt fee', () => {
    const quote = quoteManualExchange('100.10', '0.012345', '2.5');
    expect(quote.amount).toBe('100.10');
    expect(quote.rate).toBe('0.012036');
    expect(quote.targetAmount).toBe('1.20');
    expect(quote.fee).toBe('0.00');
    for (const amount of ['0', '-1', '1.001', 'Infinity', '10000000.01']) {
      expect(() => quoteManualExchange(amount, '0.012345', '2.5')).toThrow(
        BadRequestException,
      );
    }
    expect(() => quoteManualExchange('10', '1', '100')).toThrow(
      BadRequestException,
    );
  });
});
