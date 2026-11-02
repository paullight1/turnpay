import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { PaymentService } from './payment.service';
import { encryptSensitiveValue } from '../common/utils/encryption';

describe('PaymentService withdrawals', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    bankAccount: {
      findFirst: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    providerEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    transferAttempt: {
      create: jest.fn(),
      update: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const wallets = {
    getWallet: jest.fn(),
  };
  const monnifyBanks = {
    listBanks: jest.fn(),
    resolveBankAccount: jest.fn(),
    initiateTransfer: jest.fn(),
    authorizeTransfer: jest.fn(),
    resendTransferOtp: jest.fn(),
    getTransferStatus: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'BANKING_PROVIDER_PRIMARY'
        ? 'monnify'
        : key === 'BANK_ACCOUNT_ENCRYPTION_KEY'
          ? 'test-bank-account-encryption-key'
          : key === 'MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER'
            ? '2432628862'
            : undefined,
    ),
    getOrThrow: jest.fn(() => 'secret'),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const ledger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };
  const transactionPin = {
    verifyRequired: jest.fn(),
  };
  const settlementHold = {
    assertSettlementAllowed: jest.fn(),
  };

  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.transaction.findUnique.mockResolvedValue(null);
    service = new PaymentService(
      prisma,
      wallets as any,
      monnifyBanks as any,
      config as any,
      logger as any,
      ledger as any,
      transactionPin as any,
      settlementHold as any,
    );
  });

  it('withdraws to a saved beneficiary using ledger debit and transfer attempt tracking', async () => {
    wallets.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
      dailyWithdrawLimit: new Decimal(500000),
      monthlyWithdrawLimit: new Decimal(5000000),
      dailyWithdrawn: new Decimal(0),
      monthlyWithdrawn: new Decimal(0),
      limitResetDate: new Date(Date.now() + 86400000),
    });
    prisma.bankAccount.findFirst.mockResolvedValue({
      id: 'beneficiary-1',
      bankCode: '044',
      bankName: 'Test Bank',
      accountName: 'ADA LOVELACE',
      accountNumberEncrypted: encryptSensitiveValue(
        '0123456789',
        'test-bank-account-encryption-key',
      ),
      accountNumberMasked: '******6789',
      currency: 'NGN',
      provider: 'MONNIFY',
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'WD-1',
    });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4000),
    });
    monnifyBanks.resolveBankAccount.mockResolvedValue({
      accountName: 'ADA LOVELACE',
      bankName: 'Test Bank',
      bankCode: '044',
    });
    monnifyBanks.initiateTransfer.mockResolvedValue({
      reference: 'WD-1',
      status: 'SUCCESS',
    });
    prisma.transferAttempt.create.mockResolvedValue({
      id: 'attempt-1',
    });

    const result = await service.withdraw(
      'user-1',
      {
        amount: '1000',
        currency: 'NGN',
        beneficiaryId: 'beneficiary-1',
        provider: 'monnify',
      } as any,
      'test-idempotency-key',
    );

    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        amount: new Decimal(1000),
        transactionId: 'tx-1',
        source: 'WITHDRAWAL',
      }),
      prisma,
    );
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          accountNumberMasked: '******6789',
        }),
      }),
    });
    expect(
      JSON.stringify(prisma.transaction.create.mock.calls[0][0]),
    ).not.toContain('0123456789');
    expect(prisma.transferAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 'tx-1',
        provider: 'MONNIFY',
        providerReference: 'WD-1',
        providerStatus: 'RESERVED',
        status: 'PENDING',
      }),
      select: { id: true },
    });
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        providerStatus: 'SUCCESS',
        status: 'SUCCESS',
      }),
    });
    expect(monnifyBanks.initiateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccountNumber: '2432628862',
      }),
    );
    expect(result.reference).toBe('WD-1');
  });

  it('reverses the ledger debit once when provider transfer fails synchronously', async () => {
    wallets.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
      dailyWithdrawLimit: new Decimal(500000),
      monthlyWithdrawLimit: new Decimal(5000000),
      dailyWithdrawn: new Decimal(0),
      monthlyWithdrawn: new Decimal(0),
      limitResetDate: new Date(Date.now() + 86400000),
    });
    prisma.bankAccount.findFirst.mockResolvedValue({
      id: 'beneficiary-1',
      bankCode: '044',
      bankName: 'Test Bank',
      accountName: 'ADA LOVELACE',
      accountNumberEncrypted: encryptSensitiveValue(
        '0123456789',
        'test-bank-account-encryption-key',
      ),
      accountNumberMasked: '******6789',
      currency: 'NGN',
      provider: 'MONNIFY',
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'WD-1',
    });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4000),
    });
    monnifyBanks.resolveBankAccount.mockResolvedValue({
      accountName: 'ADA LOVELACE',
      bankName: 'Test Bank',
      bankCode: '044',
    });
    monnifyBanks.initiateTransfer.mockResolvedValue({
      reference: 'WD-1',
      status: 'FAILED',
    });
    prisma.transferAttempt.create.mockResolvedValue({
      id: 'attempt-1',
    });

    await expect(
      service.withdraw(
        'user-1',
        {
          amount: '1000',
          currency: 'NGN',
          beneficiaryId: 'beneficiary-1',
          provider: 'monnify',
        } as any,
        'test-idempotency-key',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        amount: new Decimal(1000),
        transactionId: 'tx-1',
        source: 'WITHDRAWAL_REVERSAL',
      }),
      prisma,
    );
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        providerStatus: 'FAILED',
        status: 'FAILED',
      }),
    });
  });

  it('keeps a withdrawal pending when Monnify submission times out but status requery returns pending', async () => {
    wallets.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
      dailyWithdrawLimit: new Decimal(500000),
      monthlyWithdrawLimit: new Decimal(5000000),
      dailyWithdrawn: new Decimal(0),
      monthlyWithdrawn: new Decimal(0),
      limitResetDate: new Date(Date.now() + 86400000),
    });
    prisma.bankAccount.findFirst.mockResolvedValue({
      id: 'beneficiary-1',
      bankCode: '044',
      bankName: 'Test Bank',
      accountName: 'ADA LOVELACE',
      accountNumberEncrypted: encryptSensitiveValue(
        '0123456789',
        'test-bank-account-encryption-key',
      ),
      accountNumberMasked: '******6789',
      currency: 'NGN',
      provider: 'MONNIFY',
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'WD-1',
    });
    prisma.transaction.update.mockResolvedValue({});
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4000),
    });
    monnifyBanks.resolveBankAccount.mockResolvedValue({
      accountName: 'ADA LOVELACE',
      bankName: 'Test Bank',
      bankCode: '044',
    });
    monnifyBanks.initiateTransfer.mockRejectedValue(
      new Error('Monnify timeout'),
    );
    monnifyBanks.getTransferStatus.mockResolvedValue({
      reference: 'WD-1',
      status: 'PENDING',
      raw: {},
    });
    prisma.transferAttempt.create.mockResolvedValue({
      id: 'attempt-1',
    });
    prisma.transferAttempt.update.mockResolvedValue({
      id: 'attempt-1',
    });

    const result = await service.withdraw(
      'user-1',
      {
        amount: '1000',
        currency: 'NGN',
        beneficiaryId: 'beneficiary-1',
        provider: 'monnify',
      } as any,
      'test-idempotency-key',
    );

    expect(monnifyBanks.getTransferStatus).toHaveBeenCalledWith('WD-1');
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        providerStatus: 'PENDING',
        status: 'PENDING',
      }),
    });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(result).toEqual({
      reference: 'WD-1',
      status: 'PENDING',
      message: 'Withdrawal submitted and pending provider confirmation',
    });
  });

  it('processes transfer success webhooks through provider events', async () => {
    prisma.providerEvent.create.mockResolvedValue({
      id: 'event-1',
      status: 'PROCESSING',
    });
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      type: 'WITHDRAW',
      status: 'PENDING',
      amount: new Decimal(1000),
      currency: 'NGN',
      reference: 'WD-1',
      transferAttempts: [
        {
          id: 'attempt-1',
          metadata: { accountNumberMasked: '******6789' },
        },
      ],
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.processTransferWebhook({
      provider: 'monnify',
      eventType: 'SUCCESSFUL_DISBURSEMENT',
      providerReference: 'WD-1',
      providerStatus: 'SUCCESS',
      rawPayload: {
        eventType: 'SUCCESSFUL_DISBURSEMENT',
        data: {
          reference: 'WD-1',
          status: 'SUCCESS',
          account_number: '0123456789',
        },
      },
    });

    expect(result).toEqual({ received: true, processed: true });
    expect(prisma.providerEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'MONNIFY',
        eventType: 'SUCCESSFUL_DISBURSEMENT',
        providerReference: 'WD-1',
        status: 'PROCESSING',
        payload: expect.objectContaining({
          data: expect.not.objectContaining({
            account_number: '0123456789',
          }),
        }),
      }),
      select: { id: true, status: true },
    });
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'PENDING' },
      data: { status: 'SUCCESS' },
    });
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({
          providerStatus: 'SUCCESS',
          status: 'SUCCESS',
        }),
      }),
    );
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('returns duplicate result when a transfer webhook event is already processed', async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`provider`,`providerReference`,`eventType`,`payloadHash`)',
      {
        code: 'P2002',
        clientVersion: '6.17.0',
        meta: {
          target: ['provider', 'providerReference', 'eventType', 'payloadHash'],
        },
      },
    );
    prisma.providerEvent.create.mockRejectedValue(duplicateError);

    const result = await service.processTransferWebhook({
      provider: 'monnify',
      eventType: 'SUCCESSFUL_DISBURSEMENT',
      providerReference: 'WD-1',
      providerStatus: 'SUCCESS',
      rawPayload: {
        eventType: 'SUCCESSFUL_DISBURSEMENT',
        data: {
          reference: 'WD-1',
          status: 'SUCCESS',
        },
      },
    });

    expect(result).toEqual({
      received: true,
      processed: false,
      duplicate: true,
    });
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.transferAttempt.update).not.toHaveBeenCalled();
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('ignores transfer webhook events when the referenced withdrawal does not exist', async () => {
    prisma.providerEvent.create.mockResolvedValue({
      id: 'event-1',
      status: 'PROCESSING',
    });
    prisma.transaction.findUnique.mockResolvedValue(null);

    const result = await service.processTransferWebhook({
      provider: 'monnify',
      eventType: 'FAILED_DISBURSEMENT',
      providerReference: 'WD-MISSING',
      providerStatus: 'FAILED',
      rawPayload: {
        eventType: 'FAILED_DISBURSEMENT',
        data: {
          reference: 'WD-MISSING',
          status: 'FAILED',
        },
      },
    });

    expect(result).toEqual({ received: true, processed: false });
    expect(prisma.providerEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        status: 'IGNORED',
        errorMessage: 'Withdrawal transaction not found',
        processedAt: expect.any(Date),
      },
    });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('reverses failed transfer webhooks exactly once when no reversal exists', async () => {
    prisma.providerEvent.create.mockResolvedValue({
      id: 'event-1',
      status: 'PROCESSING',
    });
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      type: 'WITHDRAW',
      status: 'PENDING',
      amount: new Decimal(1000),
      currency: 'NGN',
      reference: 'WD-1',
      transferAttempts: [{ id: 'attempt-1', metadata: {} }],
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await service.processTransferWebhook({
      provider: 'monnify',
      eventType: 'FAILED_DISBURSEMENT',
      providerReference: 'WD-1',
      providerStatus: 'FAILED',
      rawPayload: {
        eventType: 'FAILED_DISBURSEMENT',
        data: { reference: 'WD-1', status: 'FAILED' },
      },
    });

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        transactionId: 'tx-1',
        reference: 'WD-1-REVERSAL',
        source: 'WITHDRAWAL_REVERSAL',
      }),
      prisma,
    );
  });

  it('resets stale withdrawal counters before applying daily/monthly limits', async () => {
    wallets.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
      dailyWithdrawLimit: new Decimal(500000),
      monthlyWithdrawLimit: new Decimal(5000000),
      dailyWithdrawn: new Decimal(0),
      monthlyWithdrawn: new Decimal(0),
      dailyLimitResetDate: new Date(2020, 0, 1),
      limitResetDate: new Date(2020, 0, 1),
    });
    prisma.bankAccount.findFirst.mockResolvedValue({
      id: 'beneficiary-1',
      bankCode: '044',
      bankName: 'Test Bank',
      accountName: 'ADA LOVELACE',
      accountNumberEncrypted: encryptSensitiveValue(
        '0123456789',
        'test-bank-account-encryption-key',
      ),
      accountNumberMasked: '******6789',
      currency: 'NGN',
      provider: 'MONNIFY',
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'WD-1',
    });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4000),
    });
    monnifyBanks.resolveBankAccount.mockResolvedValue({
      accountName: 'ADA LOVELACE',
      bankName: 'Test Bank',
      bankCode: '044',
    });
    monnifyBanks.initiateTransfer.mockResolvedValue({
      reference: 'WD-1',
      status: 'SUCCESS',
    });
    prisma.transferAttempt.create.mockResolvedValue({
      id: 'attempt-1',
    });

    const result = await service.withdraw(
      'user-1',
      {
        amount: '1000',
        currency: 'NGN',
        beneficiaryId: 'beneficiary-1',
        provider: 'monnify',
      } as any,
      'test-idempotency-key',
    );

    // First reset call clears the stale daily counter for a new UTC day.
    expect(prisma.user.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: 'user-1',
          OR: [
            { dailyLimitResetDate: null },
            { dailyLimitResetDate: { lt: expect.any(Date) } },
          ],
        },
        data: expect.objectContaining({
          dailyWithdrawn: new Decimal(0),
        }),
      }),
    );
    // Second reset call clears the stale monthly counter for a new UTC month.
    expect(prisma.user.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: 'user-1',
          OR: [
            { limitResetDate: null },
            { limitResetDate: { lt: expect.any(Date) } },
          ],
        },
        data: expect.objectContaining({
          monthlyWithdrawn: new Decimal(0),
        }),
      }),
    );
    expect(result.reference).toBe('WD-1');
  });

  it('reverses a previously successful transfer when provider later sends reversed', async () => {
    prisma.providerEvent.create.mockResolvedValue({
      id: 'event-1',
      status: 'PROCESSING',
    });
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      type: 'WITHDRAW',
      status: 'SUCCESS',
      amount: new Decimal(1000),
      currency: 'NGN',
      reference: 'WD-1',
      transferAttempts: [{ id: 'attempt-1', metadata: {} }],
    });
    prisma.transaction.updateMany.mockImplementation(({ where }) =>
      Promise.resolve({
        count:
          where.status?.in?.includes('SUCCESS') || where.status === 'SUCCESS'
            ? 1
            : 0,
      }),
    );
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await service.processTransferWebhook({
      provider: 'monnify',
      eventType: 'REVERSED_DISBURSEMENT',
      providerReference: 'WD-1',
      providerStatus: 'REVERSED',
      rawPayload: {
        eventType: 'REVERSED_DISBURSEMENT',
        data: { reference: 'WD-1', status: 'REVERSED' },
      },
    });

    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: { in: ['PENDING', 'SUCCESS'] } },
      data: { status: 'REVERSED' },
    });
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        transactionId: 'tx-1',
        reference: 'WD-1-REVERSAL',
        source: 'WITHDRAWAL_REVERSAL',
      }),
      prisma,
    );
  });

  it('reconciles an expired pending withdrawal from Monnify and reverses it once', async () => {
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      reference: 'WD-1',
      amount: new Decimal(1000),
      currency: 'NGN',
      status: 'PENDING',
      metadata: { accountNumberMasked: '******6789' },
      transferAttempts: [
        {
          id: 'attempt-1',
          providerReference: 'WD-1',
          providerStatus: 'PENDING_AUTHORIZATION',
          status: 'PENDING',
          attemptNo: 1,
          lastCheckedAt: null,
          metadata: {
            beneficiaryId: 'beneficiary-1',
            accountNumberMasked: '******6789',
            providerTransactionReference: 'MNF-1',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.transferAttempt.update.mockResolvedValue({
      id: 'attempt-1',
    });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);
    monnifyBanks.getTransferStatus.mockResolvedValue({
      reference: 'MNF-1',
      status: 'EXPIRED',
      responseMessage: 'Transaction has expired',
      raw: {},
    });

    const result = await service.getWithdrawal('user-1', 'WD-1');

    expect(monnifyBanks.getTransferStatus).toHaveBeenCalledWith('MNF-1');
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        providerStatus: 'EXPIRED',
        status: 'FAILED',
      }),
    });
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        transactionId: 'tx-1',
        reference: 'WD-1-REVERSAL',
        source: 'WITHDRAWAL_REVERSAL',
      }),
      prisma,
    );
    expect(result.status).toBe('FAILED');
    expect(result.transferAttempts[0].providerStatus).toBe('EXPIRED');
  });

  it('authorizes a pending withdrawal using the Monnify OTP flow', async () => {
    const transferAttemptMetadata = {
      beneficiaryId: 'beneficiary-1',
      accountNumberMasked: '******6789',
      providerTransactionReference: 'MNF-1',
    };

    prisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      reference: 'WD-1',
      amount: new Decimal(1000),
      currency: 'NGN',
      status: 'PENDING',
      metadata: { accountNumberMasked: '******6789' },
      transferAttempts: [
        {
          id: 'attempt-1',
          providerReference: 'WD-1',
          providerStatus: 'PENDING_AUTHORIZATION',
          status: 'PENDING',
          attemptNo: 1,
          lastCheckedAt: null,
          metadata: transferAttemptMetadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.transferAttempt.update.mockResolvedValue({
      id: 'attempt-1',
    });
    monnifyBanks.getTransferStatus.mockResolvedValue({
      reference: 'MNF-1',
      status: 'PENDING_AUTHORIZATION',
      raw: {},
    });
    monnifyBanks.authorizeTransfer.mockResolvedValue({
      reference: 'MNF-1',
      transactionReference: 'MNF-1',
      status: 'AWAITING_PROCESSING',
      responseMessage: 'OTP accepted',
      raw: {},
    });

    const result = await service.authorizeWithdrawal(
      'user-1',
      'WD-1',
      '123456',
    );

    expect(monnifyBanks.authorizeTransfer).toHaveBeenCalledWith({
      reference: 'MNF-1',
      authorizationCode: '123456',
    });
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'PENDING' },
      data: { status: 'PENDING' },
    });
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        providerStatus: 'AWAITING_PROCESSING',
        status: 'PENDING',
      }),
    });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(result).toEqual({
      reference: 'WD-1',
      status: 'PENDING',
      message: 'Withdrawal authorization submitted',
    });
  });

  it('resends Monnify OTP for a pending withdrawal', async () => {
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      reference: 'WD-1',
      amount: new Decimal(1000),
      currency: 'NGN',
      status: 'PENDING',
      metadata: { accountNumberMasked: '******6789' },
      transferAttempts: [
        {
          id: 'attempt-1',
          providerReference: 'WD-1',
          providerStatus: 'PENDING_AUTHORIZATION',
          status: 'PENDING',
          attemptNo: 1,
          lastCheckedAt: null,
          metadata: {
            beneficiaryId: 'beneficiary-1',
            accountNumberMasked: '******6789',
            providerTransactionReference: 'MNF-1',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    prisma.transferAttempt.update.mockResolvedValue({
      id: 'attempt-1',
    });
    monnifyBanks.getTransferStatus.mockResolvedValue({
      reference: 'MNF-1',
      status: 'PENDING_AUTHORIZATION',
      raw: {},
    });
    monnifyBanks.resendTransferOtp.mockResolvedValue({
      reference: 'MNF-1',
      responseMessage: 'OTP resent',
      emailRecipients: ['trustpaylink@gmail.com'],
      raw: {},
    });

    const result = await service.resendWithdrawalOtp('user-1', 'WD-1');

    expect(monnifyBanks.resendTransferOtp).toHaveBeenCalledWith('MNF-1');
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          otpResentAt: expect.any(String),
          providerTransactionReference: 'MNF-1',
        }),
      }),
    });
    expect(result).toEqual({
      reference: 'MNF-1',
      message: 'OTP resent',
      emailRecipients: ['trustpaylink@gmail.com'],
    });
  });
});
