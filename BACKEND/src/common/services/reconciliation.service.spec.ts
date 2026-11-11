import { Decimal } from '@prisma/client/runtime/library';
import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  const prisma = {
    $transaction: jest.fn(
      async (operation: (tx: unknown) => unknown): Promise<unknown> =>
        operation(prisma),
    ),
    reconciliationRun: {
      create: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      findMany: jest.fn(),
    },
    ledgerEntry: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    internalTransferAttempt: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    internalTransferReversal: { findMany: jest.fn() },
    internalTransferLimitUsage: { findMany: jest.fn() },
    transaction: { findMany: jest.fn() },
  };
  const pinoLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let service: ReconciliationService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (tx: unknown) => unknown) => operation(prisma),
    );
    service = new ReconciliationService(prisma as never, pinoLogger as any);
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

  it.each(['99.99', '100.01'])(
    'flags exactly one minor unit of balance drift (%s)',
    async (balance) => {
      prisma.ledgerEntry.groupBy.mockResolvedValue([
        {
          walletId: 'wallet-1',
          direction: 'CREDIT',
          currency: 'NGN',
          _sum: { amount: new Decimal('100.00') },
        },
      ]);
      prisma.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-1',
          userId: 'user-1',
          currency: 'NGN',
          balance: new Decimal(balance),
        },
      ]);
      const result = await service.reconcileWallets();
      expect(result.mismatches).toEqual([
        {
          walletId: 'wallet-1',
          userId: 'user-1',
          currency: 'NGN',
          expectedBalance: '100.00',
          actualBalance: balance,
          difference: '0.01',
        },
      ]);
    },
  );

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

  describe('internal transfer reconciliation', () => {
    const successfulAttempt = () => ({
      id: 'attempt-1',
      userId: 'sender-1',
      recipientUserId: 'recipient-1',
      transferReference: 'IT-1',
      senderTransactionId: 'tx-out',
      recipientTransactionId: 'tx-in',
      status: 'SUCCESS',
      amount: new Decimal('100.00'),
      currency: 'NGN',
      idempotencyKeyHash: 'a'.repeat(64),
      requestHash: 'b'.repeat(64),
      response: {
        reference: 'IT-1',
        amount: '100',
        currency: 'NGN',
        senderTransactionReference: 'IT-1-OUT',
      },
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    const transactions = () => [
      {
        id: 'tx-out',
        userId: 'sender-1',
        reference: 'IT-1-OUT',
        amount: new Decimal('100.00'),
        currency: 'NGN',
        type: 'INTERNAL_TRANSFER',
      },
      {
        id: 'tx-in',
        userId: 'recipient-1',
        reference: 'IT-1-IN',
        amount: new Decimal('100.00'),
        currency: 'NGN',
        type: 'INTERNAL_TRANSFER',
      },
    ];
    const ledgers = () => [
      {
        transactionId: 'tx-out',
        direction: 'DEBIT',
        amount: new Decimal('100.00'),
        currency: 'NGN',
        reference: 'IT-1',
        source: 'INTERNAL_TRANSFER_OUT',
      },
      {
        transactionId: 'tx-in',
        direction: 'CREDIT',
        amount: new Decimal('100.00'),
        currency: 'NGN',
        reference: 'IT-1',
        source: 'INTERNAL_TRANSFER_IN',
      },
    ];
    const usages = () => [
      {
        userId: 'sender-1',
        currency: 'NGN',
        period: 'DAILY',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        amount: new Decimal('100.00'),
      },
      {
        userId: 'sender-1',
        currency: 'NGN',
        period: 'MONTHLY',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        amount: new Decimal('100.00'),
      },
    ];

    const arrange = (
      overrides: {
        attempts?: unknown[];
        transactions?: unknown[];
        ledgers?: unknown[];
        usages?: unknown[];
        reversals?: unknown[];
        duplicates?: unknown[];
      } = {},
    ) => {
      prisma.internalTransferAttempt.findMany.mockResolvedValue(
        overrides.attempts ?? [successfulAttempt()],
      );
      prisma.transaction.findMany.mockResolvedValue(
        overrides.transactions ?? transactions(),
      );
      prisma.ledgerEntry.findMany.mockResolvedValue(
        overrides.ledgers ?? ledgers(),
      );
      prisma.internalTransferLimitUsage.findMany.mockResolvedValue(
        overrides.usages ?? usages(),
      );
      prisma.internalTransferReversal.findMany.mockResolvedValue(
        overrides.reversals ?? [],
      );
      prisma.internalTransferAttempt.groupBy.mockResolvedValue(
        overrides.duplicates ?? [],
      );
    };

    it('accepts a complete transfer, ledger, snapshot, and limit pair', async () => {
      arrange();

      await expect(service.reconcileInternalTransfers()).resolves.toMatchObject(
        {
          totalChecked: 1,
          mismatches: [],
        },
      );
    });

    it('persists and alerts on a zero-tolerance blocked hourly run', async () => {
      prisma.reconciliationRun.create.mockResolvedValue({
        id: 'run-transfer-1',
      });
      jest.spyOn(service, 'reconcileInternalTransfers').mockResolvedValue({
        totalChecked: 1,
        mismatches: [
          {
            code: 'MISSING_LEDGER_LEG',
            reference: 'IT-1',
            detail: 'Missing debit ledger leg',
          },
        ],
        timestamp: new Date().toISOString(),
      });

      await service.runInternalTransferReconciliation();

      expect(prisma.reconciliationRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-transfer-1' },
          data: expect.objectContaining({
            status: 'BLOCKED',
            mismatchCount: 1,
          }),
        }),
      );
      expect(pinoLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          alertCode: 'INTERNAL_TRANSFER_RECONCILIATION_BLOCKED',
        }),
        'Internal transfer reconciliation blocked',
      );
    });

    it.each([
      {
        name: 'missing transaction leg',
        code: 'MISSING_TRANSFER_LEG',
        overrides: { transactions: transactions().slice(0, 1) },
      },
      {
        name: 'unequal amount',
        code: 'TRANSFER_AMOUNT_MISMATCH',
        overrides: {
          transactions: [
            transactions()[0],
            { ...transactions()[1], amount: new Decimal('99.00') },
          ],
        },
      },
      {
        name: 'wrong currency',
        code: 'TRANSFER_CURRENCY_MISMATCH',
        overrides: {
          transactions: [
            transactions()[0],
            { ...transactions()[1], currency: 'GHS' },
          ],
        },
      },
      {
        name: 'missing ledger leg',
        code: 'MISSING_LEDGER_LEG',
        overrides: { ledgers: ledgers().slice(0, 1) },
      },
      {
        name: 'orphan response snapshot',
        code: 'RESPONSE_SNAPSHOT_MISMATCH',
        overrides: { attempts: [{ ...successfulAttempt(), response: null }] },
      },
      {
        name: 'duplicate business key',
        code: 'DUPLICATE_BUSINESS_KEY',
        overrides: {
          duplicates: [
            {
              userId: 'sender-1',
              idempotencyKeyHash: 'a'.repeat(64),
              _count: { _all: 2 },
            },
          ],
        },
      },
      {
        name: 'understated limit usage',
        code: 'LIMIT_USAGE_UNDERSTATED',
        overrides: {
          usages: usages().map((usage) => ({
            ...usage,
            amount: new Decimal('99.00'),
          })),
        },
      },
      {
        name: 'broken completed reversal',
        code: 'BROKEN_REVERSAL_PAIR',
        overrides: {
          reversals: [
            {
              id: 'reversal-1',
              status: 'COMPLETED',
              originalTransferReference: 'IT-1',
              reversalReference: 'ITR-1',
              reversalSenderTransactionId: 'missing-credit',
              reversalRecipientTransactionId: 'missing-debit',
              amount: new Decimal('100.00'),
              currency: 'NGN',
            },
          ],
        },
      },
    ])('blocks $name', async ({ code, overrides }) => {
      arrange(overrides);

      const result = await service.reconcileInternalTransfers();

      expect(result.mismatches).toEqual(
        expect.arrayContaining([expect.objectContaining({ code })]),
      );
    });
  });
});
