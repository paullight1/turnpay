import { ConfigService } from '@nestjs/config';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { TransactionPinService } from '../src/common/services/transaction-pin.service';
import { RedisService } from '../src/redis/redis.service';
import type { InternalTransferResponse } from '../src/transfers/internal-transfer-idempotency.service';
import {
  TransferPostCommitFault,
  TransferPostCommitHook,
} from '../src/transfers/transfer-post-commit.hook';
import {
  cleanupFinancialTransferFixture,
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  createRealTransferServices,
  type FinancialTransferFixture,
  walletBalance,
} from './support/transfer-fixtures';

describe('Internal transfer fault E2E (real PostgreSQL and Redis)', () => {
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

  it('returns the original response after process loss following commit', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    const amount = new Decimal('75.25');
    const senderBefore = await walletBalance(
      prisma,
      fixture.users.sender.id,
      'NGN',
    );
    const recipientBefore = await walletBalance(
      prisma,
      fixture.users.recipientA.id,
      'NGN',
    );
    const hook = new TerminateAfterCommitHook();
    const firstInstance = createRealTransferServices(prisma, {
      postCommitHook: hook,
    }).transfers;
    const secondInstance = createRealTransferServices(prisma).transfers;
    const context = fixture.context('post-commit-kill');
    const request = {
      recipientId: fixture.users.recipientA.id,
      amount: amount.toFixed(2),
      currency: 'NGN' as const,
    };

    await expect(
      firstInstance.sendInternalTransfer(
        fixture.users.sender.id,
        request,
        context,
      ),
    ).rejects.toBeInstanceOf(TransferPostCommitFault);
    expect(hook.committedResponse).toBeDefined();

    const retryResponse = await secondInstance.sendInternalTransfer(
      fixture.users.sender.id,
      request,
      context,
    );
    const senderBalanceAfter = await walletBalance(
      prisma,
      fixture.users.sender.id,
      'NGN',
    );
    const recipientBalanceAfter = await walletBalance(
      prisma,
      fixture.users.recipientA.id,
      'NGN',
    );
    const successfulAttempts = await prisma.internalTransferAttempt.findMany({
      where: { userId: fixture.users.sender.id, status: 'SUCCESS' },
    });
    const transferTransactions = await prisma.transaction.findMany({
      where: {
        userId: {
          in: [fixture.users.sender.id, fixture.users.recipientA.id],
        },
        type: 'INTERNAL_TRANSFER',
      },
    });
    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { reference: retryResponse.reference },
    });
    const limitReservations = await prisma.internalTransferLimitUsage.findMany({
      where: { userId: fixture.users.sender.id, currency: 'NGN' },
    });
    const auditEvents = await prisma.auditLog.findMany({
      where: {
        action: 'internal_transfer_completed',
        reference: retryResponse.reference,
      },
    });

    expect(senderBalanceAfter).toEqual(senderBefore.minus(amount));
    expect(recipientBalanceAfter).toEqual(recipientBefore.plus(amount));
    expect(successfulAttempts).toHaveLength(1);
    expect(transferTransactions).toHaveLength(2);
    expect(ledgerEntries).toHaveLength(2);
    expect(limitReservations).toHaveLength(2);
    expect(
      limitReservations.every(({ amount: reserved }) =>
        new Decimal(reserved).equals(amount),
      ),
    ).toBe(true);
    expect(auditEvents).toHaveLength(1);
    expect(retryResponse.reference).toBe(hook.committedResponse?.reference);
    expect(retryResponse).toEqual(hook.committedResponse);
  });

  it('fails PIN mutations and transfers closed during Redis loss, then recovers safely', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    const redisUrl = requireFinancialRedisUrl();
    const logger = createLoggerMock();
    const config = new ConfigService({
      NODE_ENV: 'staging',
      REDIS_URL: redisUrl,
      REDIS_ALLOW_MEMORY_FALLBACK: false,
      TRANSACTION_PIN_REQUIRED: true,
    });
    const redis = new RedisService(config, logger as never);
    await redis.onModuleInit();
    const pin = new TransactionPinService(redis, config, prisma as never);

    try {
      await pin.setPin(fixture.users.sender.id, '2468');
      const originalCredential =
        await prisma.transactionPinCredential.findUniqueOrThrow({
          where: { userId: fixture.users.sender.id },
        });
      const senderBefore = await walletBalance(
        prisma,
        fixture.users.sender.id,
        'NGN',
      );
      const recipientBefore = await walletBalance(
        prisma,
        fixture.users.recipientA.id,
        'NGN',
      );
      const transfers = createRealTransferServices(prisma, {
        pinVerifier: pin,
      }).transfers;
      const context = fixture.context('redis-recovery');
      const request = {
        recipientId: fixture.users.recipientA.id,
        amount: '15.00',
        currency: 'NGN' as const,
        transactionPin: '2468',
      };

      const redisClosed = new Promise<void>((resolve) => {
        redis.getClient().once('close', () => resolve());
      });
      redis.getClient().disconnect(false);
      await redisClosed;
      expect(redis.isAvailable()).toBe(false);

      await expect(
        pin.setPin(fixture.users.sender.id, '1357'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        transfers.sendInternalTransfer(
          fixture.users.sender.id,
          request,
          context,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      const credentialAfterFailure =
        await prisma.transactionPinCredential.findUniqueOrThrow({
          where: { userId: fixture.users.sender.id },
        });
      expect(credentialAfterFailure.hash).toBe(originalCredential.hash);
      expect(
        await walletBalance(prisma, fixture.users.sender.id, 'NGN'),
      ).toEqual(senderBefore);
      expect(
        await walletBalance(prisma, fixture.users.recipientA.id, 'NGN'),
      ).toEqual(recipientBefore);

      await redis.getClient().connect();
      await redis.getClient().ping();
      expect(redis.isAvailable()).toBe(true);

      const recovered = await transfers.sendInternalTransfer(
        fixture.users.sender.id,
        request,
        context,
      );
      expect(recovered.status).toBe('SUCCESS');
      expect(
        await walletBalance(prisma, fixture.users.sender.id, 'NGN'),
      ).toEqual(senderBefore.minus('15.00'));
    } finally {
      await redis.onModuleDestroy();
    }
  });

  it('makes reversal requests idempotent and rejects a changed reason', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    const { transfers, reversals } = createRealTransferServices(prisma);
    const transfer = await transfers.sendInternalTransfer(
      fixture.users.sender.id,
      {
        recipientId: fixture.users.recipientA.id,
        amount: '25.00',
        currency: 'NGN',
      },
      fixture.context('reversal-source'),
    );
    const context = fixture.context('reversal-request');

    const first = await reversals.requestReversal(
      transfer.reference,
      { reason: 'Customer confirmed an accidental duplicate transfer' },
      fixture.users.requesterAdmin.id,
      context,
    );
    const replay = await reversals.requestReversal(
      transfer.reference,
      { reason: 'Customer confirmed an accidental duplicate transfer' },
      fixture.users.requesterAdmin.id,
      context,
    );

    expect(replay.id).toBe(first.id);
    await expect(
      reversals.requestReversal(
        transfer.reference,
        { reason: 'A materially different administrative justification' },
        fixture.users.requesterAdmin.id,
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.internalTransferReversal.count({
        where: { originalTransferReference: transfer.reference },
      }),
    ).toBe(1);
  });

  it('allows exactly one concurrent four-eyes approval and conserves wallet value', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    const { transfers, reversals } = createRealTransferServices(prisma);
    const totalBefore = await totalNgn(prisma, fixture);
    const transfer = await transfers.sendInternalTransfer(
      fixture.users.sender.id,
      {
        recipientId: fixture.users.recipientA.id,
        amount: '250.00',
        currency: 'NGN',
      },
      fixture.context('concurrent-reversal-source'),
    );
    const requested = await reversals.requestReversal(
      transfer.reference,
      { reason: 'Verified operations correction requiring four eyes' },
      fixture.users.requesterAdmin.id,
      fixture.context('concurrent-reversal-request'),
    );

    const outcomes = await Promise.allSettled([
      reversals.approveReversal(
        requested.id,
        { reason: 'Approval A after independent evidence review' },
        fixture.users.approverAdminA.id,
      ),
      reversals.approveReversal(
        requested.id,
        { reason: 'Approval B after independent evidence review' },
        fixture.users.approverAdminB.id,
      ),
    ]);

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const persisted = await prisma.internalTransferReversal.findUniqueOrThrow({
      where: { id: requested.id },
    });
    expect(persisted.status).toBe('COMPLETED');
    expect(await totalNgn(prisma, fixture)).toEqual(totalBefore);
    expect(
      await prisma.transaction.count({
        where: {
          userId: {
            in: [fixture.users.sender.id, fixture.users.recipientA.id],
          },
          type: 'INTERNAL_TRANSFER',
        },
      }),
    ).toBe(4);
  });

  it('blocks a full reversal when the recipient has spent the funds without creating money', async () => {
    const isolated = await createFinancialTransferFixture(prisma, {
      senderBalance: '100.00',
      createPolicies: false,
    });
    try {
      const { transfers, reversals } = createRealTransferServices(prisma);
      const totalBefore = await totalNgn(prisma, isolated);
      const original = await transfers.sendInternalTransfer(
        isolated.users.sender.id,
        {
          recipientId: isolated.users.recipientA.id,
          amount: '80.00',
          currency: 'NGN',
        },
        isolated.context('blocked-reversal-source'),
      );
      await transfers.sendInternalTransfer(
        isolated.users.recipientA.id,
        {
          recipientId: isolated.users.recipientB.id,
          amount: '180.00',
          currency: 'NGN',
        },
        isolated.context('recipient-spend'),
      );
      const requested = await reversals.requestReversal(
        original.reference,
        { reason: 'Recipient balance check for a full compensating reversal' },
        isolated.users.requesterAdmin.id,
        isolated.context('blocked-reversal-request'),
      );

      const result = await reversals.approveReversal(
        requested.id,
        { reason: 'Independent approval attempted after balance verification' },
        isolated.users.approverAdminA.id,
      );

      expect(result.status).toBe('BLOCKED');
      expect(await totalNgn(prisma, isolated)).toEqual(totalBefore);
      expect(
        await walletBalance(prisma, isolated.users.sender.id, 'NGN'),
      ).toEqual(new Decimal('20.00'));
      expect(
        await walletBalance(prisma, isolated.users.recipientA.id, 'NGN'),
      ).toEqual(new Decimal('0.00'));
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'internal_transfer_reversal_blocked',
            targetId: requested.id,
          },
        }),
      ).toBe(1);
    } finally {
      await cleanupFinancialTransferFixture(prisma, isolated);
    }
  });
});

class TerminateAfterCommitHook extends TransferPostCommitHook {
  committedResponse?: InternalTransferResponse;

  override async afterCommit(response: InternalTransferResponse) {
    this.committedResponse = response;
    throw new TransferPostCommitFault();
  }
}

function requireFinancialRedisUrl() {
  const redisUrl = process.env.FINANCIAL_TEST_REDIS_URL;
  if (!redisUrl) {
    throw new Error(
      'FINANCIAL_TEST_REDIS_URL is required for real financial fault tests',
    );
  }
  return redisUrl;
}

function createLoggerMock() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

async function totalNgn(
  prisma: PrismaClient,
  fixture: FinancialTransferFixture,
) {
  const balances = await Promise.all(
    [
      fixture.users.sender.id,
      fixture.users.recipientA.id,
      fixture.users.recipientB.id,
    ].map((userId) => walletBalance(prisma, userId, 'NGN')),
  );
  return balances.reduce(
    (total, balance) => total.plus(balance),
    new Decimal(0),
  );
}
