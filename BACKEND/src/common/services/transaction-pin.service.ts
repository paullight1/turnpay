import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { pbkdf2, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestAuditContext } from './request-audit-context';

type StoredPin = {
  salt: string;
  hash: string;
  iterations: number;
  pinLength: number;
};

const PIN_ITERATIONS = 210_000;
const LOCK_SECONDS = 15 * 60;
const MAX_FAILED_ATTEMPTS = 5;
// Absolute ceiling on failed attempts within a rolling 24h window. Without this
// the 5-per-15-min window still permits ~480 guesses/day, which slowly brute
// forces a 4-digit PIN. After this many failures the PIN is locked for the rest
// of the day and only a successful verify (or PIN reset) clears it.
const MAX_DAILY_FAILED_ATTEMPTS = 15;
const DAILY_WINDOW_SECONDS = 60 * 60 * 24;
const pbkdf2Async = promisify(pbkdf2);
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
    private readonly prisma: PrismaService,
  ) {}

  async setPin(userId: string, pin: string) {
    this.redis.assertAvailable();
    this.assertValidPin(pin);
    const stored = await this.buildStoredPin(pin);

    await this.prisma.transactionPinCredential.upsert({
      where: { userId },
      create: { userId, ...stored },
      update: { ...stored, resetHoldUntil: null },
    });
    await this.redis.del(this.legacyPinKey(userId));
    await this.clearFailures(userId);
    return { success: true };
  }

  async resetPinWithHold(
    userId: string,
    pin: string,
    auditContext?: RequestAuditContext & {
      verificationMethod?: 'current_pin' | 'otp';
    },
  ) {
    this.redis.assertAvailable();
    this.assertValidPin(pin);
    const stored = await this.buildStoredPin(pin);
    const resetHoldUntil = new Date(Date.now() + 60 * 60 * 1000);

    // One write publishes the credential and its hold together. Redis cleanup
    // may fail afterward, but must never leave a usable, unheld replacement.
    await this.prisma.$transaction(async (tx) => {
      await tx.transactionPinCredential.upsert({
        where: { userId },
        create: { userId, ...stored, resetHoldUntil },
        update: { ...stored, resetHoldUntil },
      });
      await tx.auditLog.create({
        data: {
          action: 'transaction_pin_reset',
          targetType: 'USER',
          targetId: userId,
          metadata: {
            actorUserId: userId,
            verificationMethod: auditContext?.verificationMethod,
            holdUntil: resetHoldUntil.toISOString(),
            requestId: auditContext?.requestId,
            ipAddress: auditContext?.ipAddress,
            userAgent: auditContext?.userAgent,
          },
        },
      });
    });
    try {
      await this.redis.del(this.legacyPinKey(userId));
      await this.clearFailures(userId);
    } catch {
      // The durable reset already succeeded. Reporting a transient failure
      // would discard the endpoint's idempotency result and invite a new reset.
      this.redis.reportOperationalAlert('TRANSACTION_PIN_RESET_CLEANUP_FAILED');
    }
    return { success: true, holdUntil: resetHoldUntil.toISOString() };
  }

  async setInitialPin(userId: string, pin: string) {
    this.redis.assertAvailable();
    this.assertValidPin(pin);
    if (await this.redis.get(this.legacyPinKey(userId))) {
      return false;
    }

    try {
      const stored = await this.buildStoredPin(pin);
      await this.prisma.transactionPinCredential.create({
        data: { userId, ...stored },
      });
      await this.clearFailures(userId);
      return true;
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        return false;
      }
      throw error;
    }
  }

  async verifyPin(userId: string, pin: string, enforceResetHold = false) {
    this.assertValidPin(pin);

    const locked = await this.redis.get(this.lockKey(userId));
    if (locked) {
      throw new ForbiddenException('Transaction PIN is temporarily locked');
    }

    let stored = await this.prisma.transactionPinCredential.findUnique({
      where: { userId },
      select: {
        salt: true,
        hash: true,
        iterations: true,
        resetHoldUntil: true,
      },
    });
    let legacyCredential = false;

    if (!stored) {
      const raw = await this.redis.get(this.legacyPinKey(userId));
      if (raw) {
        stored = { ...(JSON.parse(raw) as StoredPin), resetHoldUntil: null };
        legacyCredential = true;
      }
    }

    if (!stored) {
      throw new ForbiddenException('Transaction PIN setup is required');
    }

    if (enforceResetHold) this.assertResetHoldExpired(stored.resetHoldUntil);

    const candidate = await this.hashPin(pin, stored.salt, stored.iterations);
    const isValid = this.safeEqual(candidate, stored.hash);

    if (!isValid) {
      await this.recordFailure(userId);
      throw new ForbiddenException('Invalid transaction PIN');
    }

    if (legacyCredential) {
      await this.prisma.transactionPinCredential.upsert({
        where: { userId },
        create: { userId, ...stored, pinLength: pin.length },
        update: {},
      });
      await this.redis.del(this.legacyPinKey(userId));
    }

    await this.clearFailures(userId);

    if (enforceResetHold) {
      // PBKDF2 and Redis operations yield to other requests. Reject if a reset
      // changed the verified credential while this authorization was running.
      const current = await this.prisma.transactionPinCredential.findUnique({
        where: { userId },
        select: { hash: true, resetHoldUntil: true },
      });
      if (!current || current.hash !== stored.hash) {
        throw new ForbiddenException(
          'Transaction PIN changed; please try again',
        );
      }
      this.assertResetHoldExpired(current.resetHoldUntil);
    }
  }

  async getStatus(userId: string) {
    const [credential, locked] = await Promise.all([
      this.prisma.transactionPinCredential.findUnique({
        where: { userId },
        select: { pinLength: true, resetHoldUntil: true },
      }),
      this.redis.get(this.lockKey(userId)),
    ]);

    return {
      configured: credential !== null,
      pinLength: credential?.pinLength ?? null,
      resetHoldUntil: credential?.resetHoldUntil?.toISOString() ?? null,
      locked: Boolean(locked),
    };
  }

  async setResetHold(userId: string, holdSeconds = 60 * 60) {
    this.redis.assertAvailable();
    const holdUntil = new Date(Date.now() + holdSeconds * 1000).toISOString();
    await this.prisma.transactionPinCredential.update({
      where: { userId },
      data: { resetHoldUntil: new Date(holdUntil) },
    });
    await this.redis.del(this.legacyResetHoldKey(userId));
    return holdUntil;
  }

  async verifyRequired(userId: string, pin?: string) {
    if (!this.isRequired()) {
      return;
    }

    const legacyResetHold = await this.redis.get(
      this.legacyResetHoldKey(userId),
    );
    if (legacyResetHold) {
      throw new ForbiddenException(
        'Transaction PIN was recently reset; money movement is temporarily locked',
      );
    }

    if (!pin) {
      throw new BadRequestException('Transaction PIN is required');
    }

    await this.verifyPin(userId, pin, true);
  }

  private assertResetHoldExpired(holdUntil: Date | null) {
    if (holdUntil && holdUntil > new Date()) {
      throw new ForbiddenException(
        'Transaction PIN was recently reset; money movement is temporarily locked',
      );
    }
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
    this.redis.assertAvailable();
    if (this.redis.isAvailable()) {
      await this.recordFailureWithRedis(userId);
      return;
    }

    await this.withLocalLock(`transaction-pin:${userId}:failure`, async () => {
      await this.recordFailureWithLocalState(userId);
    });
  }

  private async recordFailureWithRedis(userId: string) {
    const result = (await this.redis.execute(
      'transaction-pin-failure',
      (client) =>
        client.eval(
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
        ),
    )) as [number, number, number, number];
    if (Number(result[2]) === 1) {
      this.redis.reportOperationalAlert('TRANSACTION_PIN_LOCK_TRIGGERED', {
        lockWindow:
          Number(result[1]) >= MAX_DAILY_FAILED_ATTEMPTS ? 'daily' : 'rolling',
      });
    }
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
      this.redis.reportOperationalAlert('TRANSACTION_PIN_LOCK_TRIGGERED', {
        lockWindow: 'daily',
      });
      return;
    }

    const failuresKey = this.failuresKey(userId);
    const current = Number((await this.redis.get(failuresKey)) || '0');
    const next = current + 1;

    if (next >= MAX_FAILED_ATTEMPTS) {
      await this.redis.set(this.lockKey(userId), '1', LOCK_SECONDS);
      await this.redis.del(failuresKey);
      this.redis.reportOperationalAlert('TRANSACTION_PIN_LOCK_TRIGGERED', {
        lockWindow: 'rolling',
      });
      return;
    }

    await this.redis.set(failuresKey, String(next), LOCK_SECONDS);
  }

  private async clearFailures(userId: string) {
    await this.redis.del(this.failuresKey(userId));
    await this.redis.del(this.dailyFailuresKey(userId));
    await this.redis.del(this.lockKey(userId));
  }

  private async hashPin(pin: string, salt: string, iterations: number) {
    const derived = await pbkdf2Async(pin, salt, iterations, 32, 'sha256');
    return derived.toString('base64url');
  }

  private async buildStoredPin(pin: string): Promise<StoredPin> {
    const salt = randomBytes(16).toString('base64url');
    return {
      salt,
      iterations: PIN_ITERATIONS,
      pinLength: pin.length,
      hash: await this.hashPin(pin, salt, PIN_ITERATIONS),
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

  private legacyPinKey(userId: string) {
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

  private legacyResetHoldKey(userId: string) {
    return `transaction-pin-reset-hold:${userId}`;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
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
