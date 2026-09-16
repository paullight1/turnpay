import { Decimal } from '@prisma/client/runtime/library';
import { of, throwError } from 'rxjs';
import { RateService } from './rate.service';

const NOW = new Date('2026-09-05T12:00:00.000Z').getTime();

function createRateService(options: {
  stored?: Record<string, unknown> | null;
  redisValue?: string | null;
  apiConfigured?: boolean;
}) {
  const prisma = {
    $transaction: jest.fn(),
    rate: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.stored === undefined ? null : options.stored,
        ),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: any) => unknown) =>
    fn(prisma),
  );
  const config = {
    get: jest.fn((key: string) => {
      if (options.apiConfigured && key === 'FX_API_URL') {
        return 'https://rates.example.test/latest';
      }
      if (options.apiConfigured && key === 'FX_API_KEY') {
        return 'test-key';
      }
      return undefined;
    }),
  };
  const http = { get: jest.fn() };
  const redis = {
    get: jest.fn().mockResolvedValue(options.redisValue ?? null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const service = new RateService(
    prisma as any,
    config as any,
    http as any,
    redis as any,
    logger as any,
  );

  return { service, prisma, config, http, redis, logger };
}

function openCircuit(service: RateService) {
  const state = service as any;
  state.circuitState = 'OPEN';
  state.circuitOpenedAt = NOW;
}

describe('RateService freshness and stale fallback', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not rejuvenate an old DB rate when it is read', async () => {
    const updatedAt = new Date(NOW - 2 * 60_000);
    const stored = {
      rate: new Decimal('0.3150'),
      markup: new Decimal('2.50'),
      validUntil: new Date(NOW + 10 * 60_000),
      updatedAt,
      source: 'api',
    };
    const { service } = createRateService({ stored });
    openCircuit(service);

    const result = await service.getRate('NGN', 'GHS');

    expect(result).toEqual({ rate: 0.315, markup: 2.5, isStale: true });
    expect((service as any).memoryCache.get('NGN_GHS').fetchedAt).toBe(
      updatedAt.getTime(),
    );
  });

  it('marks an expired DB rate stale when the provider is unavailable', async () => {
    const { service, http } = createRateService({
      apiConfigured: true,
      stored: {
        rate: new Decimal('0.3150'),
        markup: new Decimal('2.50'),
        validUntil: new Date(NOW - 30_000),
        updatedAt: new Date(NOW - 2 * 60_000),
        source: 'api',
      },
    });
    http.get.mockReturnValue(
      throwError(() => new Error('provider unavailable')),
    );

    const result = await service.getRate('NGN', 'GHS');

    expect(result).toEqual({ rate: 0.315, markup: 2.5, isStale: true });
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('marks a Redis rate stale when its validUntil has passed', async () => {
    const { service } = createRateService({
      redisValue: JSON.stringify({
        rate: 0.3,
        markup: 2.5,
        fetchedAt: NOW - 10_000,
        validUntil: NOW - 1_000,
      }),
    });
    openCircuit(service);

    const result = await service.getRate('NGN', 'GHS');

    expect(result).toEqual({ rate: 0.3, markup: 2.5, isStale: true });
  });

  it('does not serve an old DB rate after the bounded stale retention window', async () => {
    const { service } = createRateService({
      stored: {
        rate: new Decimal('9.99'),
        markup: new Decimal('0'),
        validUntil: new Date(NOW - 9 * 60_000),
        updatedAt: new Date(NOW - 10 * 60_000),
        source: 'api',
      },
    });
    openCircuit(service);

    const result = await service.getRate('NGN', 'GHS');

    expect(result).toEqual({ rate: 0.315, markup: 2.5, isStale: true });
  });
});

describe('RateService provider mapping and persistence safety', () => {
  it('maps each requested base to the correct direction and inverse', async () => {
    const { service, http, prisma } = createRateService({
      apiConfigured: true,
    });
    http.get
      .mockReturnValueOnce(
        of({
          data: {
            result: 'success',
            base_code: 'GHS',
            conversion_rates: { GHS: 1, NGN: 50 },
          },
        }),
      )
      .mockReturnValueOnce(
        of({
          data: {
            result: 'success',
            base_code: 'NGN',
            conversion_rates: { NGN: 1, GHS: 0.02 },
          },
        }),
      );

    await (service as any).fetchRates();

    const persisted = prisma.rate.upsert.mock.calls.map(([call]) => [
      call.where.from_to.from,
      call.where.from_to.to,
      Number(call.create.rate),
    ]);
    expect(persisted).toEqual([
      ['GHS', 'NGN', 50],
      ['NGN', 'GHS', 0.02],
      ['NGN', 'GHS', 0.02],
      ['GHS', 'NGN', 50],
    ]);

    expect((service as any).memoryCache.get('GHS_NGN').rate).toBe(50);
    expect((service as any).memoryCache.get('NGN_GHS').rate).toBe(0.02);
  });

  it('uses the same four-decimal rate in DB, memory, and Redis', async () => {
    const { service, prisma, redis } = createRateService({});

    await (service as any).saveRatesToDatabase({ NGN: 31.56789 }, 'GHS');

    expect(
      prisma.rate.upsert.mock.calls.map(([call]) => [
        call.where.from_to.from,
        call.where.from_to.to,
        Number(call.create.rate),
      ]),
    ).toEqual([
      ['GHS', 'NGN', 31.5679],
      ['NGN', 'GHS', 0.0317],
    ]);
    expect((service as any).memoryCache.get('GHS_NGN').rate).toBe(31.5679);
    expect((service as any).memoryCache.get('NGN_GHS').rate).toBe(0.0317);

    const cachedRates = redis.set.mock.calls
      .filter(([key]) => key.startsWith('fx:rate:'))
      .map(([, value]) => JSON.parse(value).rate);
    expect(cachedRates).toEqual([31.5679, 0.0317]);
  });

  it('accepts nested rates but rejects wrong bases and invalid targets', () => {
    const { service } = createRateService({});
    const extractRates = (service as any).extractRates.bind(service);

    expect(extractRates({ data: { rates: { NGN: 31.5 } } }, 'GHS')).toEqual({
      NGN: 31.5,
    });

    expect(() =>
      extractRates(
        {
          base_code: 'NGN',
          conversion_rates: { NGN: 1, GHS: 0.02 },
        },
        'GHS',
      ),
    ).toThrow('base mismatch');

    for (const conversion_rates of [
      {},
      { NGN: 0 },
      { NGN: Number.NaN },
      { NGN: Number.POSITIVE_INFINITY },
      { NGN: '31.5' },
    ]) {
      expect(() => extractRates({ conversion_rates }, 'GHS')).toThrow();
    }
  });

  it('does not count empty provider responses as successful fetches', async () => {
    const { service, http, prisma, logger } = createRateService({
      apiConfigured: true,
    });
    const saveRatesToDatabase = jest.spyOn(
      service as any,
      'saveRatesToDatabase',
    );
    http.get.mockReturnValue(
      of({
        data: {
          result: 'success',
          base_code: 'GHS',
          conversion_rates: {},
        },
      }),
    );

    await (service as any).fetchRates();

    expect(saveRatesToDatabase).not.toHaveBeenCalled();
    expect((service as any).circuitFailures).toBe(1);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ successCount: expect.anything() }),
      'FX rates fetched and cached successfully',
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not log raw upstream error details', async () => {
    const { service, http, logger } = createRateService({
      apiConfigured: true,
    });
    const secret = 'https://provider.test/key=super-secret';
    http.get.mockReturnValue(throwError(() => new Error(secret)));

    await (service as any).fetchRates();

    const providerErrors = logger.error.mock.calls.filter(([, message]) =>
      String(message).startsWith('Failed to fetch FX rates for '),
    );
    expect(providerErrors).toHaveLength(2);
    for (const [context] of providerErrors) {
      expect(context).toMatchObject({
        error: 'provider_request_failed',
        errorType: 'Error',
      });
      expect(JSON.stringify(context)).not.toContain(secret);
    }
  });

  it('commits the admin rate and audit before refreshing cache', async () => {
    const { service, prisma, redis } = createRateService({});
    const order: string[] = [];
    prisma.rate.findUnique.mockImplementation(async () => {
      order.push('read');
      return null;
    });
    prisma.rate.upsert.mockImplementation(async () => {
      order.push('db');
      return undefined;
    });
    prisma.auditLog.create.mockImplementation(async () => {
      order.push('audit');
      return undefined;
    });
    redis.set.mockImplementation(async () => {
      order.push('cache');
      return undefined;
    });

    await expect(
      service.setManualRate(
        'NGN',
        'GHS',
        0.31506,
        2.555,
        'admin-1',
        'verified market update',
      ),
    ).resolves.toEqual({ rate: 0.3151, markup: 2.56 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(order.indexOf('db')).toBeLessThan(order.indexOf('audit'));
    expect(order.indexOf('audit')).toBeLessThan(order.indexOf('cache'));
    expect(prisma.rate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ rate: '0.3151', markup: '2.56' }),
        create: expect.objectContaining({ rate: '0.3151', markup: '2.56' }),
      }),
    );
    expect(JSON.parse(redis.set.mock.calls.at(-1)[1]).rate).toBe(0.3151);
  });

  it('does not refresh cache when the admin audit write fails', async () => {
    const { service, prisma, redis } = createRateService({});
    prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      service.setManualRate(
        'NGN',
        'GHS',
        0.315,
        2.5,
        'admin-1',
        'verified market update',
      ),
    ).rejects.toThrow('audit unavailable');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
