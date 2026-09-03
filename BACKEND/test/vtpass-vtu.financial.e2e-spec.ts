import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { defer, lastValueFrom } from 'rxjs';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { VtuService } from '../src/vtu/vtu.service';
import { LedgerService } from '../src/wallets/ledger.service';
import {
  cleanupFinancialTransferFixture,
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  type FinancialTransferFixture,
  walletBalance,
} from './support/transfer-fixtures';

describe('VTpass VTU financial E2E (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fixture: FinancialTransferFixture | undefined;

  beforeAll(async () => {
    prisma = createFinancialTestPrisma();
    await prisma.$connect();
  });

  beforeEach(async () => {
    fixture = await createFinancialTransferFixture(prisma, {
      senderBalance: '500.00',
      createPolicies: false,
    });
  });

  afterEach(async () => {
    if (!fixture) return;

    const userId = fixture.users.sender.id;
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: { id: true },
    });
    await prisma.vtuOrder.deleteMany({
      where: { transactionId: { in: transactions.map(({ id }) => id) } },
    });
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: { startsWith: `${userId}:POST:/api/vtu/` } },
    });
    await cleanupFinancialTransferFixture(prisma, fixture);
    fixture = undefined;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('allows one concurrent debit, replays its IDs, and reverses only once', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');

    const provider = {
      getProviders: jest
        .fn()
        .mockResolvedValue([
          { id: 'mtn', name: 'MTN', type: 'airtime', isActive: true },
        ]),
      purchase: jest.fn().mockImplementation(async (request) => ({
        reference: request.providerRequestId,
        providerRequestId: request.providerRequestId,
        providerTransactionId: `provider-${request.providerRequestId}`,
        status: 'pending',
        message: 'Pending provider confirmation',
        safeResponse: { code: '099', status: 'pending' },
      })),
      getProviderName: jest.fn().mockReturnValue('VTPASS'),
      createProviderRequestId: jest
        .fn()
        .mockImplementation((reference: string) => `request-${reference}`),
    };
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const ledger = new LedgerService(prisma as never);
    const service = new VtuService(
      prisma as never,
      {
        getWallet: (userId: string, currency: 'NGN') =>
          prisma.wallet.findUnique({
            where: { userId_currency: { userId, currency } },
          }),
      } as never,
      provider as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      logger as never,
      ledger,
      { verifyRequired: jest.fn().mockResolvedValue(undefined) } as never,
      {
        encryptPurchasedCode: jest.fn().mockReturnValue(undefined),
        toOwnerReceipt: jest.fn().mockReturnValue({}),
      } as never,
    );
    const interceptor = new IdempotencyInterceptor(
      {
        get: jest.fn().mockResolvedValue(null),
        isAvailable: jest.fn().mockReturnValue(false),
        set: jest.fn(),
        del: jest.fn(),
      } as never,
      prisma as never,
      logger as never,
    );
    const dto = {
      type: 'airtime' as const,
      provider: 'mtn' as const,
      contactPhone: '+2348031234567',
      recipientNumber: '+2348031234567',
      amount: '400.00',
      transactionPin: '1234',
    };
    const purchase = async (key: string) => {
      const request = {
        method: 'POST',
        originalUrl: '/api/vtu/purchase',
        url: '/api/vtu/purchase',
        headers: { 'idempotency-key': key },
        user: { userId: fixture?.users.sender.id },
        body: dto,
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext;
      const stream = await interceptor.intercept(context, {
        handle: () => defer(() => service.purchase(request.user.userId!, dto)),
      });
      return lastValueFrom(stream);
    };

    const results = await Promise.allSettled([
      purchase(`${fixture.prefix}-vtu-a`),
      purchase(`${fixture.prefix}-vtu-b`),
    ]);
    const successful = results.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof purchase>>
      > => result.status === 'fulfilled',
    );

    expect(successful).toBeDefined();
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      new Decimal('100.00'),
    );
    expect(
      await prisma.ledgerEntry.count({
        where: {
          transaction: { userId: fixture.users.sender.id },
          source: 'VTU_PURCHASE',
        },
      }),
    ).toBe(1);
    expect(provider.purchase).toHaveBeenCalledTimes(1);

    const firstResponse = successful!.value as {
      reference: string;
      orderId: string;
    };
    const successfulKey =
      results[0].status === 'fulfilled'
        ? `${fixture.prefix}-vtu-a`
        : `${fixture.prefix}-vtu-b`;
    await expect(purchase(successfulKey)).resolves.toEqual(firstResponse);
    expect(provider.purchase).toHaveBeenCalledTimes(1);

    const order = await prisma.vtuOrder.findUniqueOrThrow({
      where: { id: firstResponse.orderId },
    });
    const failureEvent = {
      eventType: 'transaction-update' as const,
      providerRequestId: order.providerRequestId,
      providerReference: order.providerTransactionId ?? undefined,
      status: 'failed' as const,
      message: 'Provider marked transaction failed',
      code: '016',
    };
    await service.processVtpassWebhookEvent(failureEvent);
    await service.processVtpassWebhookEvent(failureEvent);

    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      new Decimal('500.00'),
    );
    expect(
      await prisma.ledgerEntry.count({
        where: {
          transaction: { userId: fixture.users.sender.id },
          source: 'VTU_REVERSAL',
        },
      }),
    ).toBe(1);
  });
});
