import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defer, lastValueFrom } from 'rxjs';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentService } from '../src/payments/payment.service';
import { LedgerService } from '../src/wallets/ledger.service';
import { SettlementHoldService } from '../src/common/services/settlement-hold.service';
import {
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  cleanupFinancialTransferFixture,
  walletBalance,
  type FinancialTransferFixture,
} from './support/transfer-fixtures';

describe('Withdrawal durable request binding (isolated PostgreSQL, fake Paystack)', () => {
  let prisma: PrismaClient;
  let fixture: FinancialTransferFixture;
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
    const ids = (
      await prisma.transaction.findMany({
        where: { userId: fixture.users.sender.id },
        select: { id: true },
      })
    ).map((t) => t.id);
    await prisma.transferAttempt.deleteMany({
      where: { transactionId: { in: ids } },
    });
    const references = (
      await prisma.transaction.findMany({
        where: { id: { in: ids } },
        select: { reference: true },
      })
    ).map((t) => t.reference);
    await prisma.providerEvent.deleteMany({
      where: { providerReference: { in: references } },
    });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: { startsWith: `${fixture.users.sender.id}:` } },
    });
    await cleanupFinancialTransferFixture(prisma, fixture);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('retires legacy secret-bearing digests while retaining the financial replay response', async () => {
    const rollback = new Error('fixture rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const scope = `${fixture.users.sender.id}:migration`;
        const legacy = await tx.idempotencyRecord.create({
          data: {
            scope,
            key: 'legacy',
            method: 'POST',
            path: '/api/payments/withdraw',
            requestHash: 'a'.repeat(64),
            status: 'COMPLETED',
            response: { reference: 'original-financial-operation' },
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        const protectedRow = await tx.idempotencyRecord.create({
          data: {
            scope,
            key: 'protected',
            method: 'POST',
            path: '/api/auth/login',
            requestHash: 'hmac:v1:opaque-keyed-digest',
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        // Execute the checked-in migration verbatim on the disposable DB, rolling
        // this test transaction back. No caller input is interpolated into SQL.
        await tx.$executeRawUnsafe(
          readFileSync(
            join(
              __dirname,
              '../prisma/migrations/048_retire_sensitive_idempotency_digests/migration.sql',
            ),
            'utf8',
          ),
        );
        const retired = await tx.idempotencyRecord.findUniqueOrThrow({
          where: { id: legacy.id },
        });
        expect(retired.requestHash).toBe(`legacy-retired:${legacy.id}`);
        expect(retired.status).toBe('COMPLETED');
        expect(retired.response).toEqual({
          reference: 'original-financial-operation',
        });
        expect(
          (
            await tx.idempotencyRecord.findUniqueOrThrow({
              where: { id: protectedRow.id },
            })
          ).requestHash,
        ).toBe('hmac:v1:opaque-keyed-digest');
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it.each(['concurrent', 'completion-failure', 'cache-failure'])(
    'reserves and dispatches once across %s, lost replay, and changed PIN; rejects changed amount',
    async (fault) => {
      let currentReference = '';
      const provider = {
        configured: true,
        resolveBankAccount: jest.fn().mockResolvedValue({
          accountName: 'Test Recipient',
          bankCode: '058',
        }),
        initiateTransfer: jest
          .fn()
          .mockImplementation(async ({ reference }) => {
            currentReference = reference;
            return { reference, status: 'pending' };
          }),
        getTransferStatus: jest.fn().mockImplementation(async () => ({
          status: 'pending',
          raw: {
            reference: currentReference,
            status: 'pending',
            amount: 40000,
            currency: 'NGN',
            domain: 'test',
            recipient: {
              details: { account_number: '0123456789', bank_code: '058' },
            },
          },
        })),
      };
      const pin = { verifyRequired: jest.fn() };
      const service = new PaymentService(
        prisma as never,
        {
          getWallet: (userId: string, currency: 'NGN') =>
            prisma.wallet.findUnique({
              where: { userId_currency: { userId, currency } },
            }),
        } as never,
        {} as never,
        new ConfigService({
          BANKING_PROVIDER_PRIMARY: 'paystack',
          BANK_ACCOUNT_ENCRYPTION_KEY: 'synthetic-financial-bank-key',
          PAYSTACK_SECRET_KEY: 'sk_test_synthetic',
        }),
        { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
        new LedgerService(prisma as never),
        pin as never,
        new SettlementHoldService(prisma as never),
        provider as never,
      );
      const dto = {
        amount: '400.00',
        currency: 'NGN' as const,
        bankCode: '058',
        accountNumber: '0123456789',
        transactionPin: '1234',
      };
      const userId = fixture.users.sender.id;
      const key = fixture.prefix;
      let failCompletion = fault === 'completion-failure';
      const interceptor = new IdempotencyInterceptor(
        {
          get: jest.fn().mockResolvedValue(null),
          isAvailable: () => fault === 'cache-failure',
          setIfNotExists: jest.fn().mockResolvedValue(true),
          del: jest.fn().mockResolvedValue(undefined),
          set: jest
            .fn()
            .mockRejectedValue(new Error('cache write unavailable')),
        } as never,
        {
          idempotencyRecord: {
            findUnique: prisma.idempotencyRecord.findUnique.bind(
              prisma.idempotencyRecord,
            ),
            create: prisma.idempotencyRecord.create.bind(
              prisma.idempotencyRecord,
            ),
            updateMany: prisma.idempotencyRecord.updateMany.bind(
              prisma.idempotencyRecord,
            ),
            delete: prisma.idempotencyRecord.delete.bind(
              prisma.idempotencyRecord,
            ),
            update: async (
              args: Parameters<typeof prisma.idempotencyRecord.update>[0],
            ) => {
              if (failCompletion) {
                failCompletion = false;
                throw new Error('lost completion write');
              }
              return prisma.idempotencyRecord.update(args);
            },
          },
        } as never,
        { info: jest.fn(), warn: jest.fn() } as never,
      );
      const request = () =>
        interceptor
          .intercept(
            {
              switchToHttp: () => ({
                getRequest: () => ({
                  method: 'POST',
                  originalUrl: '/api/payments/withdraw',
                  user: { userId },
                  body: dto,
                  headers: { 'idempotency-key': key },
                }),
              }),
            } as never,
            { handle: () => defer(() => service.withdraw(userId, dto, key)) },
          )
          .then((stream) => lastValueFrom(stream)) as ReturnType<
          typeof service.withdraw
        >;
      let results;
      if (fault === 'completion-failure') {
        await expect(request()).rejects.toThrow('lost completion write');
        const claim = await prisma.idempotencyRecord.findFirstOrThrow({
          where: { scope: `${userId}:POST:/api/payments/withdraw` },
        });
        expect(claim.status).toBe('IN_PROGRESS');
        await prisma.idempotencyRecord.update({
          where: { id: claim.id },
          data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
        });
        results = [await request(), await request()];
      } else if (fault === 'cache-failure')
        results = [await request(), await request()];
      else
        results = await Promise.all([
          service.withdraw(userId, dto, key),
          service.withdraw(userId, dto, key),
        ]);
      expect(results[0].reference).toBe(results[1].reference);
      pin.verifyRequired.mockRejectedValue(new Error('PIN reset hold'));
      // Direct service replay proves safety even when the generic interceptor's row is missing/expired.
      const replay = await service.withdraw(
        userId,
        { ...dto, transactionPin: '5678' },
        key,
      );
      expect(replay.reference).toBe(results[0].reference);
      expect(await walletBalance(prisma, userId, 'NGN')).toEqual(
        new Decimal('100.00'),
      );
      expect(
        await prisma.ledgerEntry.count({
          where: { transaction: { userId }, source: 'WITHDRAWAL' },
        }),
      ).toBe(1);
      expect(
        await prisma.transferAttempt.count({
          where: { transaction: { userId } },
        }),
      ).toBe(1);
      expect(provider.initiateTransfer).toHaveBeenCalledTimes(1);
      await expect(
        service.withdraw(userId, { ...dto, amount: '100.00' }, key),
      ).rejects.toThrow('different financial request');
      expect(provider.initiateTransfer).toHaveBeenCalledTimes(1);
    },
  );
});
