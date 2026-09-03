import {
  Injectable,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../../redis/redis.service';

// Atomically bumps the hit counter and manages the block key so every app
// instance shares one rate-limit view. KEYS[1] = hit counter, KEYS[2] = block
// marker; ARGV = ttlMs, limit, blockDurationMs. PTTL/PEXPIRE keep everything
// in milliseconds to match the guard's inputs.
const INCREMENT_SCRIPT = `
local totalHits = redis.call("INCR", KEYS[1])
local timeToExpire = redis.call("PTTL", KEYS[1])
if timeToExpire <= 0 then
  redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[1]))
  timeToExpire = tonumber(ARGV[1])
end
local isBlocked = redis.call("EXISTS", KEYS[2])
local timeToBlockExpire = 0
if isBlocked == 1 then
  timeToBlockExpire = redis.call("PTTL", KEYS[2])
elseif totalHits > tonumber(ARGV[2]) then
  redis.call("SET", KEYS[2], 1, "PX", tonumber(ARGV[3]))
  isBlocked = 1
  timeToBlockExpire = tonumber(ARGV[3])
end
return { totalHits, timeToExpire, isBlocked, timeToBlockExpire }
`;

@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  // Local storage is a deliberate development/test mode, never a deployed
  // failover. Per-process failover would let users evade limits by changing
  // application instances.
  private readonly memoryFallback = new ThrottlerStorageService();

  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.redisService.isAvailable()) {
      return this.incrementInExplicitMemoryMode(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }

    const namespacedKey = `throttler:{${throttlerName}:${key}}`;

    try {
      const result = (await this.redisService
        .getClient()
        .eval(
          INCREMENT_SCRIPT,
          2,
          namespacedKey,
          `${namespacedKey}:blocked`,
          String(ttl),
          String(limit),
          String(blockDuration > 0 ? blockDuration : ttl),
        )) as [number, number, number, number];

      if (result[2] === 1 && result[0] === limit + 1) {
        this.redisService.reportOperationalAlert(
          'RATE_LIMIT_THRESHOLD_EXCEEDED',
          { throttlerName, limit },
        );
      }

      return {
        totalHits: result[0],
        // The guard expects seconds (it feeds Retry-After); Redis PTTL is ms.
        timeToExpire: Math.max(0, Math.ceil(result[1] / 1000)),
        isBlocked: result[2] === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(result[3] / 1000)),
      };
    } catch {
      return this.incrementInExplicitMemoryMode(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  onApplicationShutdown() {
    this.memoryFallback.onApplicationShutdown();
  }

  private incrementInExplicitMemoryMode(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    if (!this.redisService.isMemoryFallbackAllowed()) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'DISTRIBUTED_CONTROLS_UNAVAILABLE',
        message: 'Distributed controls unavailable',
      });
    }
    return this.memoryFallback.increment(
      key,
      ttl,
      limit,
      blockDuration,
      throttlerName,
    );
  }
}
