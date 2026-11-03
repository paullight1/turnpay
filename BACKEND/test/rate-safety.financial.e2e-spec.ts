import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { RateService } from '../src/exchange/providers/rate.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createFinancialTestPrisma } from './support/transfer-fixtures';

describe('admin FX pair safety (real PostgreSQL)', () => {
  let db: PrismaClient;
  let rates: RateService;
  let saved: Awaited<ReturnType<PrismaClient['rate']['findMany']>>;
  const adminId = randomUUID();
  const pairWhere = {
    OR: [
      { from: 'NGN', to: 'GHS' },
      { from: 'GHS', to: 'NGN' },
    ],
  };
  beforeAll(async () => {
    db = createFinancialTestPrisma();
    await db.$connect();
    saved = await db.rate.findMany({ where: pairWhere });
    await db.user.create({
      data: {
        id: adminId,
        email: `fx-safety-${adminId}@example.invalid`,
        phone: `+1999${Date.now()}`,
        password: 'synthetic-test-noncredential',
        role: 'ADMIN',
      },
    });
    rates = new RateService(
      db as PrismaService,
      new ConfigService({ FX_RATE_SOURCE: 'admin' }),
      {} as never,
      { set: async () => undefined } as never,
      { info: () => undefined } as never,
    );
  });
  beforeEach(async () => {
    await db.rate.deleteMany({ where: pairWhere });
    await db.auditLog.deleteMany({ where: { adminId } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.rate.deleteMany({ where: pairWhere });
    if (saved?.length) await db.rate.createMany({ data: saved });
    await db.auditLog.deleteMany({ where: { adminId } });
    await db.user.deleteMany({ where: { id: adminId } });
    await db.$disconnect();
  });
  const set = (
    from: string,
    rate: number,
    basis: 'TARGET_PER_SOURCE' | 'SOURCE_PER_TARGET' = 'TARGET_PER_SOURCE',
  ) =>
    rates.setManualRate(
      from,
      from === 'NGN' ? 'GHS' : 'NGN',
      rate,
      0,
      adminId,
      'Synthetic pair safety',
      undefined,
      { quoteBasis: basis },
    );
  const seed = (
    from: string,
    rate: string,
    basis: 'TARGET_PER_SOURCE' | 'SOURCE_PER_TARGET' = 'TARGET_PER_SOURCE',
  ) =>
    db.rate.create({
      data: {
        from,
        to: from === 'NGN' ? 'GHS' : 'NGN',
        rate,
        markup: '0',
        source: 'admin',
        quoteBasis: basis,
      },
    });

  it('serializes concurrent first inserts so an unsafe reverse row cannot appear', async () => {
    const result = await Promise.allSettled([
      set('NGN', 87, 'SOURCE_PER_TARGET'),
      set('GHS', 90),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await db.rate.count({ where: pairWhere })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { adminId, action: 'FX_RATE_OVERRIDE' },
      }),
    ).toBe(1);
  });

  it('prevents opposite-direction concurrent edits from both passing an old snapshot', async () => {
    await seed('NGN', '0.01');
    await seed('GHS', '90');
    const result = await Promise.allSettled([
      set('NGN', 0.011),
      set('GHS', 95),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const forward = await rates.getRate('NGN', 'GHS');
    const reverse = await rates.getRate('GHS', 'NGN');
    expect(forward.rate * reverse.rate).toBeLessThanOrEqual(1);
    expect(
      await db.auditLog.count({
        where: { adminId, action: 'FX_RATE_OVERRIDE' },
      }),
    ).toBe(1);
  });

  it('also rejects unsafe prices inside an existing approval transaction', async () => {
    await seed('NGN', '0.01');
    await seed('GHS', '90');
    await expect(
      db.$transaction((tx) =>
        rates.setManualRate('GHS', 'NGN', 101, 0, undefined, undefined, tx, {
          refreshCache: false,
        }),
      ),
    ).rejects.toThrow('round trip');
    expect(
      (
        await db.rate.findUniqueOrThrow({
          where: { from_to: { from: 'GHS', to: 'NGN' } },
        })
      ).rate.toString(),
    ).toBe('90');
  });

  it('blocks the legacy crossed prices while keeping them available for admin repair', async () => {
    await seed('NGN', '87', 'SOURCE_PER_TARGET');
    await seed('GHS', '0.0111', 'SOURCE_PER_TARGET');
    await expect(rates.getRate('NGN', 'GHS')).rejects.toThrow('pricing');
    await expect(rates.getRate('GHS', 'NGN')).rejects.toThrow('pricing');
    const display = await rates.getRate('NGN', 'GHS', { forDisplay: true });
    expect(display.inputRate).toBe(87);
    expect(display.pairSafety?.safe).toBe(false);
    await set('GHS', 85);
    await expect(rates.getRate('NGN', 'GHS')).resolves.toMatchObject({
      pairSafety: { safe: true },
    });
  });
  it('rejects generous frozen terms even when the new current pair is safe', async () => {
    await seed('NGN', '0.02');
    await seed('GHS', '40');
    await set('NGN', 0.01);
    await set('GHS', 100);
    await expect(rates.getRate('NGN', 'GHS')).resolves.toMatchObject({
      pairSafety: { safe: true },
    });
    await expect(
      db.$transaction((tx) => rates.assertQuoteSafe(tx, 'NGN', 'GHS', 0.02)),
    ).rejects.toThrow('quote price changed');
  });

  it('does not let two generous historical quotes combine against a wide current spread', async () => {
    await seed('NGN', '0.01');
    await seed('GHS', '50');
    await expect(
      db.$transaction((tx) => rates.assertQuoteSafe(tx, 'NGN', 'GHS', 0.018)),
    ).rejects.toThrow('quote price changed');
    await expect(
      db.$transaction((tx) => rates.assertQuoteSafe(tx, 'GHS', 'NGN', 90)),
    ).rejects.toThrow('quote price changed');
  });

  it('holds pricing stable through the money transaction while allowing a later admin update', async () => {
    await seed('NGN', '0.01');
    await seed('GHS', '90');
    let pending: Promise<unknown> | undefined;
    let saved = false;
    await db.$transaction(async (tx) => {
      await rates.assertQuoteSafe(tx, 'NGN', 'GHS', 0.01);
      pending = set('GHS', 95).then((result) => {
        saved = true;
        return result;
      });
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const rows = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS waiting`;
        waiting = rows[0].waiting;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect(saved).toBe(false);
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'SYNTHETIC_QUOTE_BOUNDARY',
          targetType: 'Test',
          targetId: adminId,
        },
      });
    });
    await pending;
    expect(saved).toBe(true);
  });

  it('rejects a stale Serializable price snapshot after an admin update', async () => {
    await seed('NGN', '0.01');
    await seed('GHS', '90');
    await expect(
      db.$transaction(
        async (tx) => {
          await tx.rate.findMany({ where: pairWhere });
          await set('GHS', 95);
          await rates.assertQuoteSafe(tx, 'NGN', 'GHS', 0.01);
        },
        { isolationLevel: 'Serializable' },
      ),
    ).rejects.toThrow('pricing changed');
  });
});
