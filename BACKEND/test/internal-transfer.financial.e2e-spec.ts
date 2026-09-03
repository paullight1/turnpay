import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  cleanupFinancialTransferFixture,
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  createRealTransferServices,
  type FinancialTransferFixture,
  walletBalance,
} from './support/transfer-fixtures';

describe('Internal transfer financial E2E (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fixture: FinancialTransferFixture | undefined;

  beforeAll(async () => {
    prisma = createFinancialTestPrisma();
    await prisma.$connect();
  });

  beforeEach(async () => {
    fixture = await createFinancialTransferFixture(prisma);
  });

  afterEach(async () => {
    if (fixture) {
      await cleanupFinancialTransferFixture(prisma, fixture);
      fixture = undefined;
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it('accepts the minimum cent boundary and rejects sub-cent precision without side effects', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    const { transfers } = createRealTransferServices(prisma);
    const senderBefore = await walletBalance(
      prisma,
      fixture.users.sender.id,
      'NGN',
    );

    const response = await transfers.sendInternalTransfer(
      fixture.users.sender.id,
      {
        recipientId: fixture.users.recipientA.id,
        amount: '0.01',
        currency: 'NGN',
      },
      fixture.context('minimum-cent'),
    );

    expect(response.amount).toBe('0.01');
    await expect(
      transfers.sendInternalTransfer(
        fixture.users.sender.id,
        {
          recipientId: fixture.users.recipientA.id,
          amount: '0.001',
          currency: 'NGN',
        },
        fixture.context('sub-cent'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      senderBefore.minus('0.01'),
    );
    expect(
      await prisma.internalTransferAttempt.count({
        where: { userId: fixture.users.sender.id, status: 'SUCCESS' },
      }),
    ).toBe(1);
  });

  it('rolls back every financial row on insufficient balance', async () => {
    const isolated = await createFinancialTransferFixture(prisma, {
      senderBalance: '10.00',
      createPolicies: false,
    });
    try {
      const { transfers } = createRealTransferServices(prisma);
      const senderBefore = await walletBalance(
        prisma,
        isolated.users.sender.id,
        'NGN',
      );
      const recipientBefore = await walletBalance(
        prisma,
        isolated.users.recipientA.id,
        'NGN',
      );

      await expect(
        transfers.sendInternalTransfer(
          isolated.users.sender.id,
          {
            recipientId: isolated.users.recipientA.id,
            amount: '10.01',
            currency: 'NGN',
          },
          isolated.context('insufficient'),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        await walletBalance(prisma, isolated.users.sender.id, 'NGN'),
      ).toEqual(senderBefore);
      expect(
        await walletBalance(prisma, isolated.users.recipientA.id, 'NGN'),
      ).toEqual(recipientBefore);
      expect(await successfulFinancialRowCounts(prisma, isolated)).toEqual({
        attempts: 0,
        transactions: 0,
        ledgerEntries: 0,
        audits: 0,
        limitUsage: 0,
      });
    } finally {
      await cleanupFinancialTransferFixture(prisma, isolated);
    }
  });

  it('rolls back the debit when the recipient has no wallet in the requested currency', async () => {
    const isolated = await createFinancialTransferFixture(prisma, {
      createRecipientGhsWallet: false,
      createPolicies: false,
    });
    try {
      const { transfers } = createRealTransferServices(prisma);
      const senderBefore = await walletBalance(
        prisma,
        isolated.users.sender.id,
        'GHS',
      );

      await expect(
        transfers.sendInternalTransfer(
          isolated.users.sender.id,
          {
            recipientId: isolated.users.recipientA.id,
            amount: '25.00',
            currency: 'GHS',
          },
          isolated.context('currency-mismatch'),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(
        await walletBalance(prisma, isolated.users.sender.id, 'GHS'),
      ).toEqual(senderBefore);
      expect(await successfulFinancialRowCounts(prisma, isolated)).toEqual({
        attempts: 0,
        transactions: 0,
        ledgerEntries: 0,
        audits: 0,
        limitUsage: 0,
      });
    } finally {
      await cleanupFinancialTransferFixture(prisma, isolated);
    }
  });

  it('replays the exact committed response and rejects a changed body for the same key', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    const { transfers } = createRealTransferServices(prisma);
    const context = fixture.context('stable-retry-key');
    const request = {
      recipientId: fixture.users.recipientA.id,
      amount: '40.00',
      currency: 'NGN' as const,
      note: 'Stable retry',
    };

    const first = await transfers.sendInternalTransfer(
      fixture.users.sender.id,
      request,
      context,
    );
    const replay = await transfers.sendInternalTransfer(
      fixture.users.sender.id,
      request,
      context,
    );

    expect(replay).toEqual(first);
    await expect(
      transfers.sendInternalTransfer(
        fixture.users.sender.id,
        { ...request, amount: '40.01' },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await successfulFinancialRowCounts(prisma, fixture)).toEqual({
      attempts: 1,
      transactions: 2,
      ledgerEntries: 2,
      audits: 1,
      limitUsage: 2,
    });
  });

  it('serializes near-full-balance debits from two service instances', async () => {
    const isolated = await createFinancialTransferFixture(prisma, {
      senderBalance: '100.00',
      createPolicies: false,
    });
    try {
      const instanceA = createRealTransferServices(prisma).transfers;
      const instanceB = createRealTransferServices(prisma).transfers;
      const outcomes = await Promise.allSettled([
        instanceA.sendInternalTransfer(
          isolated.users.sender.id,
          {
            recipientId: isolated.users.recipientA.id,
            amount: '80.00',
            currency: 'NGN',
          },
          isolated.context('instance-a'),
        ),
        instanceB.sendInternalTransfer(
          isolated.users.sender.id,
          {
            recipientId: isolated.users.recipientB.id,
            amount: '80.00',
            currency: 'NGN',
          },
          isolated.context('instance-b'),
        ),
      ]);

      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      expect(
        await walletBalance(prisma, isolated.users.sender.id, 'NGN'),
      ).toEqual(new Decimal('20.00'));
      expect(await successfulFinancialRowCounts(prisma, isolated)).toEqual({
        attempts: 1,
        transactions: 2,
        ledgerEntries: 2,
        audits: 1,
        limitUsage: 2,
      });
    } finally {
      await cleanupFinancialTransferFixture(prisma, isolated);
    }
  });
});

async function successfulFinancialRowCounts(
  prisma: PrismaClient,
  fixture: FinancialTransferFixture,
) {
  const userIds = Object.values(fixture.users).map(({ id }) => id);
  const walletIds = fixture.wallets.map(({ id }) => id);
  const successfulAttempts = await prisma.internalTransferAttempt.findMany({
    where: { userId: { in: userIds }, status: 'SUCCESS' },
    select: { id: true },
  });
  const attemptIds = successfulAttempts.map(({ id }) => id);
  const [transactions, ledgerEntries, audits, limitUsage] = await Promise.all([
    prisma.transaction.count({
      where: { userId: { in: userIds }, type: 'INTERNAL_TRANSFER' },
    }),
    prisma.ledgerEntry.count({ where: { walletId: { in: walletIds } } }),
    prisma.auditLog.count({
      where: {
        action: 'internal_transfer_completed',
        targetId: { in: attemptIds },
      },
    }),
    prisma.internalTransferLimitUsage.count({
      where: { userId: fixture.users.sender.id },
    }),
  ]);

  return {
    attempts: successfulAttempts.length,
    transactions,
    ledgerEntries,
    audits,
    limitUsage,
  };
}
