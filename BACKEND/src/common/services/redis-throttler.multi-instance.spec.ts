import { RedisService } from '../../redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('Redis throttling across application instances', () => {
  it('shares one user bucket across instances while keeping users independent', async () => {
    const totals = new Map<string, number>();
    const client = {
      eval: jest.fn(
        async (
          _script: string,
          _keyCount: number,
          counterKey: string,
          _blockKey: string,
          ttl: string,
          limit: string,
          blockDuration: string,
        ) => {
          const total = (totals.get(counterKey) ?? 0) + 1;
          totals.set(counterKey, total);
          const blocked = total > Number(limit) ? 1 : 0;
          return [
            total,
            Number(ttl),
            blocked,
            blocked ? Number(blockDuration) : 0,
          ];
        },
      ),
    };
    const redis = {
      isAvailable: jest.fn(() => true),
      isMemoryFallbackAllowed: jest.fn(() => false),
      getClient: jest.fn(() => client),
      reportOperationalAlert: jest.fn(),
    } as unknown as RedisService;
    const instanceA = new RedisThrottlerStorage(redis);
    const instanceB = new RedisThrottlerStorage(redis);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await instanceA.increment('user:user-1', 60000, 5, 60000, 'verifiedUser');
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await instanceB.increment('user:user-1', 60000, 5, 60000, 'verifiedUser');
    }

    await expect(
      instanceA.increment('user:user-1', 60000, 5, 60000, 'verifiedUser'),
    ).resolves.toMatchObject({ totalHits: 6, isBlocked: true });
    await expect(
      instanceB.increment('user:user-2', 60000, 5, 60000, 'verifiedUser'),
    ).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
  });
});
