import type { ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { defer, lastValueFrom } from 'rxjs';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { SettlementHoldService } from '../src/common/services/settlement-hold.service';
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
      select: { id: true, reference: true },
    });
    const orders = await prisma.vtuOrder.findMany({
      where: { transactionId: { in: transactions.map((t) => t.id) } },
      select: { id: true, providerRequestId: true },
    });
    for (const order of orders)
      await prisma.webhookLog.deleteMany({
        where: {
          provider: 'VTPASS',
          reference: { contains: order.providerRequestId },
        },
      });
    await prisma.auditLog.deleteMany({
      where: { targetId: { in: orders.map((o) => o.id) } },
    });
    await prisma.paymentNotification.deleteMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
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

  it.each(['callback', 'requery', 'lost-replay'])(
    'allows one concurrent debit, replays IDs, and refunds once via %s',
    async (recoveryMode) => {
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
        requery: jest.fn().mockImplementation(async (requestId: string) => ({
          reference: `provider-${requestId}`,
          providerRequestId: requestId,
          providerTransactionId: `provider-${requestId}`,
          status: 'failed',
          message: 'Provider confirmed failure',
          safeResponse: { code: '016', status: 'failed' },
        })),
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
      const settlementHold = new SettlementHoldService(prisma as never);
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
        settlementHold,
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
          handle: () =>
            defer(() => service.purchase(request.user.userId!, dto, key)),
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

      if (!successful) {
        throw (results[0] as PromiseRejectedResult).reason;
      }
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        await walletBalance(prisma, fixture.users.sender.id, 'NGN'),
      ).toEqual(new Decimal('100.00'));
      expect(
        await prisma.ledgerEntry.count({
          where: {
            transaction: { userId: fixture.users.sender.id },
            source: 'VTU_PURCHASE',
          },
        }),
      ).toBe(1);
      expect(provider.purchase).toHaveBeenCalledTimes(1);

      const firstResponse = successful.value;
      if (
        !firstResponse ||
        typeof firstResponse !== 'object' ||
        !('orderId' in firstResponse) ||
        !('reference' in firstResponse) ||
        typeof firstResponse.orderId !== 'string'
      ) {
        throw new Error('Successful purchase did not return an order ID');
      }
      const successfulKey =
        results[0].status === 'fulfilled'
          ? `${fixture.prefix}-vtu-a`
          : `${fixture.prefix}-vtu-b`;
      if (recoveryMode === 'lost-replay') {
        // Simulate a crash after financial commit and loss/expiry of generic replay.
        await prisma.idempotencyRecord.deleteMany({
          where: {
            scope: { startsWith: `${fixture.users.sender.id}:POST:/api/vtu/` },
          },
        });
      }
      const retryResponse = await purchase(successfulKey);
      expect(retryResponse).toMatchObject({
        reference: firstResponse.reference,
        orderId: firstResponse.orderId,
      });
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
      if (recoveryMode === 'requery') {
        provider.requery.mockRejectedValueOnce(new Error('Provider timeout'));
        await expect(service.requeryOrder(order.id)).rejects.toThrow(
          'Provider timeout',
        );
        expect(
          await walletBalance(prisma, fixture.users.sender.id, 'NGN'),
        ).toEqual(new Decimal('100.00'));
        // Simulate the next due run after downtime; never issue another purchase.
        await prisma.vtuOrder.update({
          where: { id: order.id },
          data: { nextRequeryAt: new Date(0) },
        });
        await service.requeryPendingOrders(25);
        await service.requeryOrder(order.id);
        expect(provider.requery).toHaveBeenCalledTimes(2);
      } else {
        await service.processVtpassWebhookEvent(failureEvent);
        await service.processVtpassWebhookEvent(failureEvent);
        expect(provider.requery).toHaveBeenCalledTimes(1);
      }
      expect(provider.purchase).toHaveBeenCalledTimes(1);
      expect(provider.requery).toHaveBeenCalledWith(order.providerRequestId);

      expect(
        await walletBalance(prisma, fixture.users.sender.id, 'NGN'),
      ).toEqual(new Decimal('500.00'));
      expect(
        await prisma.ledgerEntry.count({
          where: {
            transaction: { userId: fixture.users.sender.id },
            source: 'VTU_REVERSAL',
          },
        }),
      ).toBe(1);

      provider.purchase.mockImplementationOnce(async (request) => ({
        reference: `late-provider-${request.providerRequestId}`,
        providerRequestId: request.providerRequestId,
        providerTransactionId: `late-provider-${request.providerRequestId}`,
        status: 'success',
        message: 'Delivered',
        providerAmount: '400.00',
        providerCurrency: 'NGN',
        providerCost: '400.00',
        safeResponse: { code: '000', status: 'delivered' },
      }));
      const lateResponse = await purchase(`${fixture.prefix}-vtu-late`);
      if (
        !lateResponse ||
        typeof lateResponse !== 'object' ||
        !('orderId' in lateResponse) ||
        typeof lateResponse.orderId !== 'string'
      ) {
        throw new Error('Late reversal purchase did not return an order ID');
      }
      const lateOrder = await prisma.vtuOrder.findUniqueOrThrow({
        where: { id: lateResponse.orderId },
      });
      provider.requery.mockResolvedValueOnce({
        reference: lateOrder.providerTransactionId,
        providerRequestId: lateOrder.providerRequestId,
        providerTransactionId: lateOrder.providerTransactionId,
        status: 'reversed',
        message: 'TRANSACTION REVERSAL TO WALLET',
        providerAmount: '400.00',
        providerCurrency: 'NGN',
        providerCost: '400.00',
        walletCreditId: `wallet-credit-${lateOrder.id}`,
        safeResponse: { code: '040', status: 'reversed' },
      });
      const lateReversalEvent = {
        eventType: 'transaction-update' as const,
        providerRequestId: lateOrder.providerRequestId,
        providerReference: lateOrder.providerTransactionId ?? undefined,
        status: 'reversed' as const,
        message: 'TRANSACTION REVERSAL TO WALLET',
        code: '040',
      };
      await service.processVtpassWebhookEvent(lateReversalEvent);
      await service.processVtpassWebhookEvent(lateReversalEvent);
      expect(
        await walletBalance(prisma, fixture.users.sender.id, 'NGN'),
      ).toEqual(new Decimal('500.00'));
      expect(
        await prisma.ledgerEntry.count({
          where: {
            transaction: { userId: fixture.users.sender.id },
            source: 'VTU_REVERSAL',
          },
        }),
      ).toBe(2);
    },
  );
  it.each(['pending', 'timeout'])(
    'keeps confirmed success and receipt when the initial response arrives late (%s)',
    async (initial) => {
      if (!fixture) throw new Error('Missing fixture');
      const userId = fixture.users.sender.id;
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const provider = {
        getProviders: async () => [
          { id: 'mtn', name: 'MTN', type: 'airtime', isActive: true },
        ],
        createProviderRequestId: (reference: string) => `request-${reference}`,
        purchase: jest.fn(async (request) => {
          await service.processVtpassWebhookEvent({
            eventType: 'transaction-update',
            providerRequestId: request.providerRequestId,
            status: 'success',
            providerReference: `provider-${request.providerRequestId}`,
            message: 'Delivered',
            code: '000',
          });
          if (initial === 'timeout') throw new Error('Late initial timeout');
          return {
            status: 'pending',
            reference: request.providerRequestId,
            message: 'stale pending',
          };
        }),
        requery: jest.fn(async (requestId: string) => ({
          status: 'success',
          reference: `provider-${requestId}`,
          providerRequestId: requestId,
          providerTransactionId: `provider-${requestId}`,
          message: 'Delivered',
          purchasedCode: 'synthetic-receipt',
          providerAmount: '100.00',
          providerCurrency: 'NGN',
        })),
      };
      const service = new VtuService(
        prisma as never,
        {
          getWallet: (id: string, currency: 'NGN') =>
            prisma.wallet.findUnique({
              where: { userId_currency: { userId: id, currency } },
            }),
        } as never,
        provider as never,
        { get: () => undefined } as never,
        logger as never,
        new LedgerService(prisma as never),
        { verifyRequired: async () => undefined } as never,
        {
          encryptPurchasedCode: (code?: string) =>
            code ? `protected:${code}` : undefined,
          toOwnerReceipt: (code?: string) =>
            code ? { purchasedCode: 'synthetic-receipt' } : {},
        } as never,
        new SettlementHoldService(prisma as never),
      );
      const result = await service.purchase(
        userId,
        {
          type: 'airtime',
          provider: 'mtn',
          amount: '100.00',
          contactPhone: '+2348031234567',
          recipientNumber: '+2348031234567',
          transactionPin: '1234',
        },
        fixture.prefix,
      );
      expect(result).toMatchObject({
        status: 'SUCCESS',
        purchasedCode: 'synthetic-receipt',
      });
      const saved = await prisma.vtuOrder.findUniqueOrThrow({
        where: { id: result.orderId },
        include: { transaction: true },
      });
      expect(saved.status).toBe('SUCCESS');
      expect(saved.transaction.status).toBe('SUCCESS');
      expect(saved.purchasedCodeEncrypted).toBe('protected:synthetic-receipt');
      // Reproduce the opposite legacy mismatch: the order was marked SUCCESS
      // but the linked transaction was left PENDING by an older version.
      await prisma.transaction.update({
        where: { id: saved.transactionId },
        data: { status: 'PENDING' },
      });
      await service.requeryOrder(saved.id);
      expect(
        (
          await prisma.transaction.findUniqueOrThrow({
            where: { id: saved.transactionId },
          })
        ).status,
      ).toBe('SUCCESS');
      expect(
        (await service.getOrderStatus(userId, result.reference)).orderStatus,
      ).toBe('SUCCESS');
      expect(await walletBalance(prisma, userId, 'NGN')).toEqual(
        new Decimal('400.00'),
      );
      expect(provider.purchase).toHaveBeenCalledTimes(1);
    },
  );
  it('backfills every exhausted order without starving a due order when the queue exceeds the batch limit', async () => {
    if (!fixture) throw new Error('Missing fixture');
    const userId = fixture.users.sender.id;
    const orderIds: string[] = [];
    for (let index = 0; index < 31; index++) {
      const exhausted = index < 30;
      const reference = `${fixture.prefix}-queue-${index}`;
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: 'AIRTIME',
          amount: '100.00',
          currency: 'NGN',
          reference,
          status: 'PENDING',
        },
      });
      const order = await prisma.vtuOrder.create({
        data: {
          transactionId: transaction.id,
          provider: 'VTPASS',
          scope: 'LOCAL',
          serviceType: 'AIRTIME',
          providerRequestId: reference,
          status: exhausted ? 'PENDING' : 'SUCCESS',
          amount: '100.00',
          currency: 'NGN',
          requeryAttempts: exhausted ? 12 : 0,
          nextRequeryAt: null,
          createdAt: exhausted ? new Date('2026-01-01') : new Date(),
        },
      });
      orderIds.push(order.id);
    }
    const provider = {
      requery: jest.fn(async (requestId: string) => ({
        status: 'success',
        reference: `provider-${requestId}`,
        providerRequestId: requestId,
        providerTransactionId: `provider-${requestId}`,
        message: 'Delivered',
        providerAmount: '100.00',
        providerCurrency: 'NGN',
      })),
    };
    const service = new VtuService(
      prisma as never,
      {} as never,
      provider as never,
      { get: () => undefined } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new LedgerService(prisma as never),
      {} as never,
      { encryptPurchasedCode: () => undefined } as never,
      new SettlementHoldService(prisma as never),
    );
    for (let batch = 0; batch < 4; batch++)
      await service.requeryPendingOrders(10);
    expect(provider.requery).toHaveBeenCalledTimes(1);
    expect(
      (await prisma.vtuOrder.findUniqueOrThrow({ where: { id: orderIds[30] } }))
        .status,
    ).toBe('SUCCESS');
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: { in: orderIds } },
      }),
    ).toBe(30);
    expect(
      await prisma.auditLog.count({
        where: { targetId: { in: orderIds }, action: 'VTU_REQUERY_EXHAUSTED' },
      }),
    ).toBe(30);
  });
  it('holds a contradictory legacy success for review until a fresh provider success repairs it', async () => {
    if (!fixture) throw new Error('Missing fixture');
    const userId = fixture.users.sender.id;
    const reference = `${fixture.prefix}-legacy-status`;
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type: 'AIRTIME',
        amount: '100.00',
        currency: 'NGN',
        reference,
        status: 'PENDING',
      },
    });
    const order = await prisma.vtuOrder.create({
      data: {
        transactionId: transaction.id,
        provider: 'VTPASS',
        scope: 'LOCAL',
        serviceType: 'AIRTIME',
        providerRequestId: reference,
        status: 'SUCCESS',
        amount: '100.00',
        currency: 'NGN',
      },
    });
    const provider = {
      requery: jest.fn(async () => ({
        status: 'failed',
        reference: 'provider-legacy',
        providerRequestId: reference,
        message: 'Contradictory old result',
      })),
    };
    const service = new VtuService(
      prisma as never,
      {} as never,
      provider as never,
      { get: () => undefined } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new LedgerService(prisma as never),
      {} as never,
      {
        encryptPurchasedCode: () => undefined,
        toOwnerReceipt: () => ({}),
      } as never,
      new SettlementHoldService(prisma as never),
    );
    await service.requeryOrder(order.id);
    let saved = await prisma.vtuOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { transaction: true },
    });
    expect(saved.status).toBe('UNKNOWN');
    expect(saved.transaction.status).toBe('PENDING');
    expect(
      (await service.getOrderStatus(userId, reference)).actionRequired,
    ).toBe(true);
    await service.requeryOrder(order.id, true);
    expect(await walletBalance(prisma, userId, 'NGN')).toEqual(
      new Decimal('500.00'),
    );
    expect(
      await prisma.ledgerEntry.count({
        where: { transactionId: transaction.id, source: 'VTU_REVERSAL' },
      }),
    ).toBe(0);
    provider.requery.mockImplementation(async () => ({
      status: 'success',
      reference: 'provider-legacy',
      providerRequestId: reference,
      message: 'Fresh verified success',
    }));
    await service.requeryOrder(order.id, true);
    saved = await prisma.vtuOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { transaction: true },
    });
    expect(saved.status).toBe('SUCCESS');
    expect(saved.transaction.status).toBe('SUCCESS');
    expect(
      (await service.getOrderStatus(userId, reference)).actionRequired,
    ).toBe(false);
  });
});
