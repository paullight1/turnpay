import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { encryptSensitiveValue } from '../common/utils/encryption';
import { PaymentService } from './payment.service';

describe('Paystack withdrawal confirmation', () => {
  const key = 'test-bank-encryption-key-32-characters';
  const reference = 'wd_fixture_reference';
  const tx = {
    transaction: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    transferAttempt: { update: jest.fn(), create: jest.fn() },
    ledgerEntry: { findFirst: jest.fn() },
    user: { updateMany: jest.fn(), findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const ledger = { creditWallet: jest.fn(), debitWallet: jest.fn() };
  const provider = {
    getTransferStatus: jest.fn(),
    resolveBankAccount: jest.fn(),
    initiateTransfer: jest.fn(),
    configured: true,
  };
  let service: PaymentService;
  beforeEach(() => {
    jest.clearAllMocks();
    tx.$transaction.mockImplementation(
      async (fn: (value: unknown) => unknown) => fn(tx),
    );
    tx.transaction.updateMany.mockResolvedValue({ count: 1 });
    tx.ledgerEntry.findFirst.mockResolvedValue(null);
    tx.transaction.findUnique.mockResolvedValue({
      id: 'tx',
      userId: 'owner',
      reference,
      type: 'WITHDRAW',
      status: 'PENDING',
      amount: new Decimal('100'),
      currency: 'NGN',
      transferAttempts: [
        {
          id: 'attempt',
          provider: 'PAYSTACK',
          metadata: {
            bankCode: '058',
            accountNumberMasked: '******6789',
            accountNumberEncrypted: encryptSensitiveValue('0123456789', key),
          },
        },
      ],
    });
    provider.getTransferStatus.mockResolvedValue({
      status: 'reversed',
      raw: {
        reference,
        status: 'reversed',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
        recipient: {
          details: { account_number: '0123456789', bank_code: '058' },
        },
      },
    });
    service = new PaymentService(
      tx as never,
      {} as never,
      {} as never,
      new ConfigService({
        BANKING_PROVIDER_PRIMARY: 'paystack',
        BANK_ACCOUNT_ENCRYPTION_KEY: key,
        PAYSTACK_SECRET_KEY: 'sk_test_fixture',
      }),
      {} as never,
      ledger as never,
      {} as never,
      {} as never,
      provider as never,
    );
  });
  const event = {
    provider: 'paystack' as const,
    eventType: 'transfer.reversed',
    providerReference: reference,
    providerStatus: 'reversed',
    rawPayload: {},
  };
  it('compares the full destination even when two accounts share the same last four digits', async () => {
    const result = await provider.getTransferStatus();
    result.raw.recipient.details.account_number = '9999996789';
    await expect(service.processTransferWebhook(event)).rejects.toThrow(
      'does not match',
    );
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });
  it('releases the reservation only once inside the guarded transaction', async () => {
    await service.processTransferWebhook(event);
    tx.transaction.updateMany.mockResolvedValue({ count: 0 });
    await service.processTransferWebhook(event);
    expect(ledger.creditWallet).toHaveBeenCalledTimes(1);
    expect(ledger.creditWallet.mock.calls[0][0].amount.toFixed(2)).toBe(
      '100.00',
    );
  });
  it('releases funds and withdrawal limits when Paystack definitively rejects initiation', async () => {
    tx.user.findUnique.mockResolvedValue({
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
      dailyWithdrawLimit: new Decimal(500000),
      monthlyWithdrawLimit: new Decimal(5000000),
      dailyWithdrawn: new Decimal(0),
      monthlyWithdrawn: new Decimal(0),
      limitResetDate: new Date(Date.now() + 86400000),
    });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.transaction.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data, id: 'withdrawal' }),
    );
    tx.transferAttempt.create.mockResolvedValue({ id: 'attempt' });
    provider.resolveBankAccount.mockResolvedValue({
      accountName: 'Test Customer',
      bankCode: '058',
    });
    provider.initiateTransfer.mockRejectedValue(
      new BadRequestException('Provider rejected transfer'),
    );
    const withdrawing = new PaymentService(
      tx as never,
      {
        getWallet: jest
          .fn()
          .mockResolvedValue({ id: 'wallet', balance: new Decimal(1000) }),
      } as never,
      {} as never,
      new ConfigService({
        BANKING_PROVIDER_PRIMARY: 'paystack',
        BANK_ACCOUNT_ENCRYPTION_KEY: key,
        PAYSTACK_SECRET_KEY: 'sk_test_fixture',
      }),
      { warn: jest.fn(), error: jest.fn() } as never,
      ledger as never,
      { verifyRequired: jest.fn() } as never,
      { assertSettlementAllowed: jest.fn() } as never,
      provider as never,
    );
    tx.transaction.findUnique.mockResolvedValueOnce(null);
    const result = await withdrawing.withdraw(
      'owner',
      {
        amount: '100.00',
        currency: 'NGN',
        bankCode: '058',
        accountNumber: '0123456789',
      },
      'test-idempotency-key',
    );
    expect(result.status).toBe('FAILED');
    expect(ledger.creditWallet).toHaveBeenCalledTimes(1);
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { dailyWithdrawn: { decrement: expect.any(Decimal) } },
      }),
    );
    expect(
      provider.initiateTransfer.mock.calls[0][0].reference.length,
    ).toBeLessThanOrEqual(50);
  });
});
