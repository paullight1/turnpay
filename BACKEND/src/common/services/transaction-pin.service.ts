import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { RedisService } from '../../redis/redis.service';

type StoredPin = {
  salt: string;
  hash: string;
  iterations: number;
};

const PIN_ITERATIONS = 210_000;
const PIN_TTL_SECONDS = 60 * 60 * 24 * 365;
const LOCK_SECONDS = 15 * 60;
const MAX_FAILED_ATTEMPTS = 5;
// Absolute ceiling on failed attempts within a rolling 24h window. Without this
// the 5-per-15-min window still permits ~480 guesses/day, which slowly brute
// forces a 4-digit PIN. After this many failures the PIN is locked for the rest
// of the day and only a successful verify (or PIN reset) clears it.
const MAX_DAILY_FAILED_ATTEMPTS = 15;
const DAILY_WINDOW_SECONDS = 60 * 60 * 24;
const RECORD_PIN_FAILURE_SCRIPT = `
local dailyCount = redis.call("INCR", KEYS[2])
local dailyTtlMs = redis.call("PTTL", KEYS[2])
if dailyTtlMs <= 0 then
  redis.call("PEXPIRE", KEYS[2], tonumber(ARGV[3]))
  dailyTtlMs = tonumber(ARGV[3])
end
if dailyCount >= tonumber(ARGV[2]) then
  redis.call("SET", KEYS[3], "1", "PX", dailyTtlMs)
  redis.call("DEL", KEYS[1])
  return { 0, dailyCount, 1, dailyTtlMs }
end
local failureCount = redis.call("INCR", KEYS[1])
local failureTtlMs = redis.call("PTTL", KEYS[1])
if failureTtlMs <= 0 then
  redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[4]))
  failureTtlMs = tonumber(ARGV[4])
end
if failureCount >= tonumber(ARGV[1]) then
  redis.call("SET", KEYS[3], "1", "PX", tonumber(ARGV[5]))
  redis.call("DEL", KEYS[1])
  return { 0, dailyCount, 1, tonumber(ARGV[5]) }
end
return { failureCount, dailyCount, 0, failureTtlMs }
`;

@Injectable()
export class TransactionPinService {
  private readonly localLocks = new Map<string, Promise<void>>();
  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async setPin(userId: string, pin: string) {
    this.assertValidPin(pin);
    const stored = this.buildStoredPin(pin);

    await this.redis.set(
      this.pinKey(userId),
      JSON.stringify(stored),
      PIN_TTL_SECONDS,
    );
    await this.clearFailures(userId);
    return { success: true };
  }

  async setInitialPin(userId: string, pin: string) {
    this.assertValidPin(pin);
    const created = await this.redis.setIfNotExists(
      this.pinKey(userId),
      JSON.stringify(this.buildStoredPin(pin)),
      PIN_TTL_SECONDS,
    );

    if (created) {
      await this.clearFailures(userId);
    }

    return created;
  }

  async verifyPin(userId: string, pin: string) {
    this.assertValidPin(pin);

    const locked = await this.redis.get(this.lockKey(userId));
    if (locked) {
      throw new ForbiddenException('Transaction PIN is temporarily locked');
    }

    const raw = await this.redis.get(this.pinKey(userId));
    if (!raw) {
      throw new ForbiddenException('Transaction PIN setup is required');
    }

    const stored = JSON.parse(raw) as StoredPin;
    const candidate = this.hashPin(pin, stored.salt, stored.iterations);
    const isValid = this.safeEqual(candidate, stored.hash);

    if (!isValid) {
      await this.recordFailure(userId);
      throw new ForbiddenException('Invalid transaction PIN');
    }

    await this.clearFailures(userId);
  }

  async setResetHold(userId: string, holdSeconds = 60 * 60) {
    const holdUntil = new Date(Date.now() + holdSeconds * 1000).toISOString();
    await this.redis.set(this.resetHoldKey(userId), holdUntil, holdSeconds);
    return holdUntil;
  }

  async verifyRequired(userId: string, pin?: string) {
    if (!this.isRequired()) {
      return;
    }

    const resetHold = await this.redis.get(this.resetHoldKey(userId));
    if (resetHold) {
      throw new ForbiddenException(
        'Transaction PIN was recently reset; money movement is temporarily locked',
      );
    }

    if (!pin) {
      throw new BadRequestException('Transaction PIN is required');
    }

    await this.verifyPin(userId, pin);
  }

  isRequired() {
    // The Joi schema in app.module defaults this to true in production; the
    // fallback here mirrors that so a bypassed/absent validation layer can
    // never silently disable PIN checks in prod.
    return this.configService.get<boolean>(
      'TRANSACTION_PIN_REQUIRED',
      this.configService.get<string>('NODE_ENV') === 'production',
    );
  }

  private assertValidPin(pin: string) {
    if (!/^\d{4,6}$/.test(pin)) {
      throw new BadRequestException('Transaction PIN must be 4 to 6 digits');
    }
  }

  private async recordFailure(userId: string) {
    if (this.redis.isRedisAvailable()) {
      await this.recordFailureWithRedis(userId);
      return;
    }

    await this.withLocalLock(`transaction-pin:${userId}:failure`, async () => {
      await this.recordFailureWithLocalState(userId);
    });
  }

  private async recordFailureWithRedis(userId: string) {
    await this.redis
      .getClient()
      .eval(
        RECORD_PIN_FAILURE_SCRIPT,
        3,
        this.failuresKey(userId),
        this.dailyFailuresKey(userId),
        this.lockKey(userId),
        String(MAX_FAILED_ATTEMPTS),
        String(MAX_DAILY_FAILED_ATTEMPTS),
        String(DAILY_WINDOW_SECONDS * 1000),
        String(LOCK_SECONDS * 1000),
        String(LOCK_SECONDS * 1000),
      );
  }

  private async recordFailureWithLocalState(userId: string) {
    // Daily hard cap — survives the short rolling window so an attacker cannot
    // reset the counter simply by pausing 15 minutes between bursts.
    const dailyKey = this.dailyFailuresKey(userId);
    const dailyCount = Number((await this.redis.get(dailyKey)) || '0') + 1;
    await this.redis.set(dailyKey, String(dailyCount), DAILY_WINDOW_SECONDS);

    if (dailyCount >= MAX_DAILY_FAILED_ATTEMPTS) {
      await this.redis.set(this.lockKey(userId), '1', DAILY_WINDOW_SECONDS);
      await this.redis.del(this.failuresKey(userId));
      return;
    }

    const failuresKey = this.failuresKey(userId);
    const current = Number((await this.redis.get(failuresKey)) || '0');
    const next = current + 1;

    if (next >= MAX_FAILED_ATTEMPTS) {
      await this.redis.set(this.lockKey(userId), '1', LOCK_SECONDS);
      await this.redis.del(failuresKey);
      return;
    }

    await this.redis.set(failuresKey, String(next), LOCK_SECONDS);
  }

  private async clearFailures(userId: string) {
    await this.redis.del(this.failuresKey(userId));
    await this.redis.del(this.dailyFailuresKey(userId));
    await this.redis.del(this.lockKey(userId));
  }

  private hashPin(pin: string, salt: string, iterations: number) {
    return pbkdf2Sync(pin, salt, iterations, 32, 'sha256').toString(
      'base64url',
    );
  }

  private buildStoredPin(pin: string): StoredPin {
    const salt = randomBytes(16).toString('base64url');
    return {
      salt,
      iterations: PIN_ITERATIONS,
      hash: this.hashPin(pin, salt, PIN_ITERATIONS),
    };
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private pinKey(userId: string) {
    return `transaction-pin:${userId}`;
  }

  private failuresKey(userId: string) {
    return `transaction-pin-failures:${userId}`;
  }

  private dailyFailuresKey(userId: string) {
    return `transaction-pin-daily-failures:${userId}`;
  }

  private lockKey(userId: string) {
    return `transaction-pin-lock:${userId}`;
  }

  private resetHoldKey(userId: string) {
    return `transaction-pin-reset-hold:${userId}`;
  }

  private async withLocalLock<T>(key: string, work: () => Promise<T>) {
    const previous = this.localLocks.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.localLocks.set(key, chain);

    await previous;

    try {
      return await work();
    } finally {
      release?.();
      if (this.localLocks.get(key) === chain) {
        this.localLocks.delete(key);
      }
    }
  }
}
