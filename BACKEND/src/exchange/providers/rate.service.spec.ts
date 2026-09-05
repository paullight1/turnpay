import { Decimal } from '@prisma/client/runtime/library';
import { throwError } from 'rxjs';
import { RateService } from './rate.service';

const NOW = new Date('2026-09-05T12:00:00.000Z').getTime();

function createRateService(options: {
  stored?: Record<string, unknown> | null;
  redisValue?: string | null;
  apiConfigured?: boolean;
}) {
  const prisma = {
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
