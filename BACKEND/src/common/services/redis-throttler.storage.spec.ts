import { ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  const createRedis = ({
    available,
    memoryAllowed,
    evalResult,
    evalError,
  }: {
    available: boolean;
    memoryAllowed: boolean;
    evalResult?: number[];
    evalError?: Error;
  }) => ({
    isAvailable: jest.fn(() => available),
    isMemoryFallbackAllowed: jest.fn(() => memoryAllowed),
    getClient: jest.fn(() => ({
      eval: evalError
        ? jest.fn().mockRejectedValue(evalError)
        : jest.fn().mockResolvedValue(evalResult ?? [1, 60000, 0, 0]),
    })),
    reportOperationalAlert: jest.fn(),
  });

  it('fails closed when the distributed limiter is unavailable', async () => {
    const storage = new RedisThrottlerStorage(
      createRedis({
        available: false,
        memoryAllowed: false,
      }) as unknown as RedisService,
    );

    await expect(
      storage.increment('ip-key', 60000, 120, 60000, 'default'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uses memory only when local fallback was explicitly enabled', async () => {
    const storage = new RedisThrottlerStorage(
      createRedis({
        available: false,
        memoryAllowed: true,
      }) as unknown as RedisService,
    );

    await expect(
      storage.increment('ip-key', 60000, 120, 60000, 'default'),
    ).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
    storage.onApplicationShutdown();
  });

  it('fails closed on a deployed command error', async () => {
    const storage = new RedisThrottlerStorage(
      createRedis({
        available: true,
        memoryAllowed: false,
        evalError: new Error('socket closed'),
      }) as unknown as RedisService,
    );

    await expect(
      storage.increment('user-key', 60000, 5, 60000, 'verifiedUser'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('emits a rate-limit alert without exposing the tracker key', async () => {
    const redis = createRedis({
      available: true,
      memoryAllowed: false,
      evalResult: [6, 60000, 1, 60000],
    });
    const storage = new RedisThrottlerStorage(redis as unknown as RedisService);

    await storage.increment(
      'sensitive-user-key',
      60000,
      5,
      60000,
      'verifiedUser',
    );

    expect(redis.reportOperationalAlert).toHaveBeenCalledWith(
      'RATE_LIMIT_THRESHOLD_EXCEEDED',
      { throttlerName: 'verifiedUser', limit: 5 },
    );
  });
});
