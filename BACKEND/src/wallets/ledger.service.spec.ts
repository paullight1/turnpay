import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  const prisma = {
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
    },
    emailOutbox: {
      createMany: jest.fn(),
    },
    reconciliationRun: {
      findMany: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
    fundingAdverseCase: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (fn: any): Promise<unknown> => fn(prisma)),
  };

  let service: LedgerService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.reconciliationRun.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.fundingAdverseCase.findMany.mockResolvedValue([]);
    prisma.emailOutbox.createMany.mockResolvedValue({ count: 1 });
    prisma.$queryRaw.mockImplementation(async (query: any) =>
      query.sql?.includes('FOR UPDATE OF w')
        ? [
            {
              id: 'wallet-1',
              balance: new Decimal(1000),
              kycTier: 'TIER_2',
              kycStatus: 'VERIFIED',
              isSuspended: false,
            },
          ]
        : [],
    );
    service = new LedgerService(prisma as never);
  });

  it('credits a wallet and records the balance movement in one transaction', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: new Decimal(1000),
    });
    prisma.wallet.update.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(1250),
    });
    prisma.ledgerEntry.create.mockResolvedValue({ id: 'ledger-1' });

    const result = await service.creditWallet({
      userId: 'user-1',
      currency: 'NGN',
      amount: new Decimal(250),
      transactionId: 'tx-1',
      reference: 'DEP-1',
      source: 'MONNIFY_DVA',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: {
        userId_currency: {
          userId: 'user-1',
          currency: 'NGN',
        },
      },
      data: { balance: { increment: new Decimal(250) } },
    });
    expect(prisma.ledgerEntry.create).toHaveBeenCalledWith({
      data: {
        transactionId: 'tx-1',
        walletId: 'wallet-1',
        direction: 'CREDIT',
        amount: new Decimal(250),
        currency: 'NGN',
        balanceBefore: new Decimal(1000),
        balanceAfter: new Decimal(1250),
        reference: 'DEP-1',
        source: 'MONNIFY_DVA',
        metadata: undefined,
      },
    });
    expect(result.balanceAfter.equals(1250)).toBe(true);
  });

  it('queues one immutable wallet-credit email for a non-deposit ledger movement', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'GHS',
      balance: new Decimal(10),
    });
    prisma.wallet.update.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(22.5),
    });
    prisma.ledgerEntry.create.mockResolvedValue({ id: 'ledger-credit-1' });

    await service.creditWallet({
      userId: 'user-1',
      currency: 'GHS',
      amount: new Decimal('12.50'),
      transactionId: 'tx-1',
      reference: 'KORA-1',
      source: 'KORA_DEPOSIT',
    });

    expect(prisma.emailOutbox.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          eventKey: 'wallet:movement:ledger-credit-1',
          eventType: 'WALLET_CREDIT',
          orderId: 'ledger-credit-1',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('keeps the existing deposit email as the sole confirmation for DVA movements', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: new Decimal(10),
    });
    prisma.wallet.update.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(22.5),
    });
    prisma.ledgerEntry.create.mockResolvedValue({ id: 'ledger-deposit-1' });

    await service.creditWallet({
      userId: 'user-1',
      currency: 'NGN',
      amount: new Decimal('12.50'),
      transactionId: 'tx-1',
      reference: 'PAY-1',
      source: 'PAYSTACK_DVA',
    });

    expect(prisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it('rolls the movement back when the transactional outbox write fails', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'GHS',
      balance: new Decimal(10),
    });
    prisma.wallet.update.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(22.5),
    });
    prisma.ledgerEntry.create.mockResolvedValue({ id: 'ledger-credit-2' });
    prisma.emailOutbox.createMany.mockRejectedValueOnce(
      new Error('outbox unavailable'),
    );

    await expect(
      service.creditWallet({
        userId: 'user-1',
        currency: 'GHS',
        amount: new Decimal('12.50'),
        transactionId: 'tx-1',
        reference: 'KORA-2',
        source: 'KORA_DEPOSIT',
      }),
    ).rejects.toThrow('outbox unavailable');
  });

  it('rejects non-positive credit amounts', async () => {
    await expect(
      service.creditWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(0),
        transactionId: 'tx-1',
        reference: 'DEP-1',
        source: 'MONNIFY_DVA',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects debit attempts that would overdraw the wallet', async () => {
    prisma.wallet.updateMany.mockResolvedValue({ count: 0 });
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: new Decimal(100),
    });

    await expect(
      service.debitWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(250),
        transactionId: 'tx-1',
        reference: 'WD-1',
        source: 'WITHDRAWAL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('records debit balance snapshots from the committed balance after atomic update', async () => {
    prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: new Decimal(700),
    });
    prisma.ledgerEntry.create.mockResolvedValue({ id: 'ledger-1' });

    const result = await service.debitWallet({
      userId: 'user-1',
      currency: 'NGN',
      amount: new Decimal(100),
      transactionId: 'tx-1',
      reference: 'WD-1',
      source: 'WITHDRAWAL',
    });

    expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        currency: 'NGN',
        balance: { gte: new Decimal(100) },
      },
      data: { balance: { decrement: new Decimal(100) } },
    });
    expect(prisma.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        balanceBefore: new Decimal(800),
        balanceAfter: new Decimal(700),
      }),
    });
    expect(result.balanceBefore.equals(800)).toBe(true);
    expect(result.balanceAfter.equals(700)).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects a debit while the persisted transaction PIN reset hold is active', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { resetHoldUntil: new Date(Date.now() + 60_000) },
    ]);

    await expect(
      service.debitWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(100),
        transactionId: 'tx-1',
        reference: 'WD-1',
        source: 'WITHDRAWAL',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('does not apply the PIN reset hold or reconciliation hold to compensation debits', async () => {
    prisma.reconciliationRun.findMany.mockResolvedValue([
      {
        id: 'blocked-run',
        scope: 'WALLET_BALANCES',
        status: 'BLOCKED',
        createdAt: new Date(),
        mismatchCount: 1,
      },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { resetHoldUntil: new Date(Date.now() + 60_000) },
    ]);
    prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: new Decimal(700),
    });
    prisma.ledgerEntry.create.mockResolvedValue({ id: 'ledger-1' });

    await expect(
      service.debitWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(100),
        transactionId: 'tx-1',
        reference: 'REV-1',
        source: 'WITHDRAWAL_REVERSAL',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        walletId: 'wallet-1',
        balanceAfter: expect.any(Decimal),
      }),
    );

    expect(prisma.reconciliationRun.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('blocks outbound debits when an unresolved reconciliation run exists', async () => {
    prisma.reconciliationRun.findMany.mockResolvedValue([
      {
        id: 'blocked-run',
        scope: 'WALLET_BALANCES',
        status: 'BLOCKED',
        createdAt: new Date(),
        mismatchCount: 1,
      },
    ]);

    await expect(
      service.debitWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(100),
        transactionId: 'tx-1',
        reference: 'WD-1',
        source: 'WITHDRAWAL',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
  });

  it('allows only audited adverse recovery past its own case hold while retaining reconciliation holds', async () => {
    prisma.fundingAdverseCase.findMany.mockResolvedValue([
      {
        id: 'case-1',
        provider: 'PAYSTACK',
        eventType: 'refund.processed',
        providerReference: 'refund-1',
      },
    ]);
    prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: new Decimal(700),
    });
    prisma.ledgerEntry.create.mockResolvedValue({ id: 'ledger-1' });

    await expect(
      service.debitWalletForAdverseFunding(
        {
          userId: 'user-1',
          currency: 'NGN',
          amount: new Decimal(100),
          transactionId: 'tx-1',
          reference: 'RECOVERY-1',
          source: 'PAYSTACK_ADVERSE_RECOVERY',
        },
        prisma as never,
      ),
    ).resolves.toEqual(expect.objectContaining({ walletId: 'wallet-1' }));
    expect(prisma.fundingAdverseCase.findMany).not.toHaveBeenCalled();

    prisma.reconciliationRun.findMany.mockResolvedValue([
      {
        id: 'blocked-run',
        scope: 'WALLET_BALANCES',
        status: 'BLOCKED',
        createdAt: new Date(),
        mismatchCount: 1,
      },
    ]);
    await expect(
      service.debitWalletForAdverseFunding(
        {
          userId: 'user-1',
          currency: 'NGN',
          amount: new Decimal(100),
          transactionId: 'tx-2',
          reference: 'RECOVERY-2',
          source: 'PAYSTACK_ADVERSE_RECOVERY',
        },
        prisma as never,
      ),
    ).rejects.toThrow('reconciliation is blocked');
  });

  it('fails when the target wallet does not exist', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null);

    await expect(
      service.creditWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(250),
        transactionId: 'tx-1',
        reference: 'DEP-1',
        source: 'MONNIFY_DVA',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
