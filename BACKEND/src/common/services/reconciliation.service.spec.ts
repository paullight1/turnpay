import { Decimal } from '@prisma/client/runtime/library';
import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  const prisma = {
    reconciliationRun: {
      create: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      findMany: jest.fn(),
    },
    ledgerEntry: {
      groupBy: jest.fn(),
    },
  };
  const pinoLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let service: ReconciliationService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ReconciliationService(prisma as any, pinoLogger as any);
  });

  it('derives expected wallet balances from aggregated ledger sums', async () => {
    prisma.ledgerEntry.groupBy.mockResolvedValue([
      {
        walletId: 'wallet-1',
        direction: 'CREDIT',
        currency: 'NGN',
        _sum: { amount: new Decimal('1000.00') },
      },
      {
        walletId: 'wallet-1',
        direction: 'DEBIT',
        currency: 'NGN',
        _sum: { amount: new Decimal('200.00') },
      },
      // Different-currency movement must not affect the NGN wallet balance.
      {
        walletId: 'wallet-1',
        direction: 'CREDIT',
        currency: 'GHS',
        _sum: { amount: new Decimal('500.00') },
      },
    ]);
    prisma.wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-1',
        userId: 'user-1',
        currency: 'NGN',
        balance: new Decimal('800.00'),
      },
    ]);

    const result = await service.reconcileWallets();

    expect(prisma.ledgerEntry.groupBy).toHaveBeenCalledWith({
      by: ['walletId', 'direction', 'currency'],
      _sum: { amount: true },
    });
    expect(prisma.wallet.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        userId: true,
        currency: true,
        balance: true,
      },
    });
    expect(result).toMatchObject({
      totalChecked: 1,
      mismatches: [],
    });
  });

  it('persists a completed reconciliation run when all wallets are in sync', async () => {
    prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-1' });
    prisma.ledgerEntry.groupBy.mockResolvedValue([]);
    prisma.wallet.findMany.mockResolvedValue([]);

    const result = await service.runDailyReconciliation();

    expect(result).toMatchObject({ totalChecked: 0, mismatches: [] });
    expect(prisma.reconciliationRun.create).toHaveBeenCalledWith({
      data: { scope: 'WALLET_BALANCES' },
    });
    expect(prisma.reconciliationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          checkedCount: 0,
          mismatchCount: 0,
        }),
      }),
    );
  });

  it('reports wallet balance drift using Decimal-formatted values', async () => {
    prisma.ledgerEntry.groupBy.mockResolvedValue([
      {
        walletId: 'wallet-1',
        direction: 'CREDIT',
        currency: 'NGN',
        _sum: { amount: new Decimal('1000.00') },
      },
      {
        walletId: 'wallet-1',
        direction: 'DEBIT',
        currency: 'NGN',
        _sum: { amount: new Decimal('200.00') },
      },
    ]);
    prisma.wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-1',
        userId: 'user-1',
        currency: 'NGN',
        balance: new Decimal('799.50'),
      },
    ]);

    const result = await service.reconcileWallets();

    expect(result.mismatches).toEqual([
      {
        walletId: 'wallet-1',
        userId: 'user-1',
        currency: 'NGN',
        expectedBalance: '800.00',
        actualBalance: '799.50',
        difference: '0.50',
      },
    ]);
  });

  it('treats a wallet with no ledger entries as expecting a zero balance', async () => {
    prisma.ledgerEntry.groupBy.mockResolvedValue([]);
    prisma.wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-1',
        userId: 'user-1',
        currency: 'NGN',
        balance: new Decimal('0.00'),
      },
    ]);

    const result = await service.reconcileWallets();

    expect(result).toMatchObject({ totalChecked: 1, mismatches: [] });
  });
});
