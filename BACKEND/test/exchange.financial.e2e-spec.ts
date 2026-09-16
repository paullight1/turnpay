import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ExchangeService } from '../src/exchange/exchange.service';
import { LedgerService } from '../src/wallets/ledger.service';
import {
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  cleanupFinancialTransferFixture,
  FinancialTransferFixture,
  walletBalance,
} from './support/transfer-fixtures';

describe('quote exchange financial boundaries (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fixture: FinancialTransferFixture | undefined;
  let service: ExchangeService;
  const quotes = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => quotes.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      quotes.set(key, value);
    }),
    // Deliberately allow both claims: the DB must protect money even after
    // cache loss or an expired Redis execution lease.
    setIfNotExists: jest.fn(async () => true),
    del: jest.fn(async (key: string) => {
      quotes.delete(key);
    }),
  };
  beforeAll(async () => {
    prisma = createFinancialTestPrisma();
    await prisma.$connect();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    quotes.clear();
    fixture = await createFinancialTransferFixture(prisma, {
      createPolicies: false,
    });
    service = new ExchangeService(
      prisma as never,
      {
        getRate: jest
          .fn()
          .mockResolvedValue({ rate: 0.02, markup: 0, isStale: false }),
      } as never,
      redis as never,
      new ConfigService(),
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new LedgerService(prisma as never),
      { verifyRequired: jest.fn() } as never,
    );
  });
  afterEach(async () => {
    if (fixture) await cleanupFinancialTransferFixture(prisma, fixture);
    fixture = undefined;
  });
  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });
  function user() {
    if (!fixture) throw new Error('Financial fixture missing');
    return fixture.users.sender.id;
  }
  const quote = (amount = '100.00') =>
    service.createQuote(user(), { from: 'NGN', to: 'GHS', amount });

  it('protects legacy writers during a rolling deployment', async () => {
    const quoteId = randomUUID();
    const data = {
      userId: user(),
      type: 'EXCHANGE' as const,
      amount: '100.00',
      currency: 'NGN' as const,
      status: 'SUCCESS' as const,
      reference: randomUUID(),
      metadata: { quoteId },
    };
    const legacy = await prisma.transaction.create({ data });
    expect(legacy.exchangeQuoteId).toBe(quoteId);
    await expect(
      prisma.transaction.create({ data: { ...data, reference: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.transaction.count({ where: { exchangeQuoteId: quoteId } }),
    ).toBe(1);
  });

  it('commits one debit and credit across concurrent executions and replays after cache loss', async () => {
    const created = await quote();
    const results = await Promise.allSettled([
      service.executeQuote(user(), { quoteId: created.id }),
      service.executeQuote(user(), { quoteId: created.id }),
    ]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      await prisma.transaction.count({
        where: { exchangeQuoteId: created.id },
      }),
    ).toBe(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { transaction: { exchangeQuoteId: created.id } },
      }),
    ).toBe(2);
    expect((await walletBalance(prisma, user(), 'NGN')).toFixed(2)).toBe(
      '899.00',
    );
    expect((await walletBalance(prisma, user(), 'GHS')).toFixed(2)).toBe(
      '1002.00',
    );
    quotes.clear();
    const replay = await service.executeQuote(user(), { quoteId: created.id });
    const committed = results.find((result) => result.status === 'fulfilled');
    if (committed?.status !== 'fulfilled')
      throw new Error('No committed exchange');
    expect(replay).toEqual(committed.value);
  });

  it('recovers a lost response after commit when Redis cleanup fails', async () => {
    const created = await quote();
    redis.del.mockRejectedValueOnce(new Error('Redis disconnected'));
    await expect(
      service.executeQuote(user(), { quoteId: created.id }),
    ).rejects.toThrow('Redis disconnected');
    const replay = await service.executeQuote(user(), { quoteId: created.id });
    expect(replay.success).toBe(true);
    expect(
      await prisma.transaction.count({
        where: { exchangeQuoteId: created.id },
      }),
    ).toBe(1);
    expect((await walletBalance(prisma, user(), 'NGN')).toFixed(2)).toBe(
      '899.00',
    );
  });

  it('rolls back the transaction and ledger when funds are insufficient', async () => {
    const created = await quote('1000.00');
    await expect(
      service.executeQuote(user(), { quoteId: created.id }),
    ).rejects.toThrow('Insufficient');
    expect(
      await prisma.transaction.count({
        where: { exchangeQuoteId: created.id },
      }),
    ).toBe(0);
    expect(
      await prisma.ledgerEntry.count({ where: { wallet: { userId: user() } } }),
    ).toBe(0);
    expect((await walletBalance(prisma, user(), 'NGN')).toFixed(2)).toBe(
      '1000.00',
    );
  });

  it('rejects an expired persisted quote and cross-user replay', async () => {
    const created = await quote();
    quotes.set(
      `quote:${created.id}`,
      JSON.stringify({ ...created, expiresAt: new Date(0) }),
    );
    await expect(
      service.executeQuote(user(), { quoteId: created.id }),
    ).rejects.toThrow('expired');
    const valid = await quote();
    await service.executeQuote(user(), { quoteId: valid.id });
    await expect(
      service.executeQuote(fixture!.users.recipientA.id, { quoteId: valid.id }),
    ).rejects.toThrow('does not belong');
    await expect(
      service.executeQuote(user(), { quoteId: randomUUID() }),
    ).rejects.toThrow('Quote not found');
  });
});
