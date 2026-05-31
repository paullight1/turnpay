import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import { RedisService } from "../../redis/redis.service";

type StoredPin = {
  salt: string;
  hash: string;
  iterations: number;
};

const PIN_ITERATIONS = 210_000;
const PIN_TTL_SECONDS = 60 * 60 * 24 * 365;
const LOCK_SECONDS = 15 * 60;
const MAX_FAILED_ATTEMPTS = 5;

@Injectable()
export class TransactionPinService {
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
      throw new ForbiddenException("Transaction PIN is temporarily locked");
    }

    const raw = await this.redis.get(this.pinKey(userId));
    if (!raw) {
      throw new ForbiddenException("Transaction PIN setup is required");
    }

    const stored = JSON.parse(raw) as StoredPin;
    const candidate = this.hashPin(pin, stored.salt, stored.iterations);
    const isValid = this.safeEqual(candidate, stored.hash);

    if (!isValid) {
      await this.recordFailure(userId);
      throw new ForbiddenException("Invalid transaction PIN");
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
        "Transaction PIN was recently reset; money movement is temporarily locked",
      );
    }

    if (!pin) {
      throw new BadRequestException("Transaction PIN is required");
    }

    await this.verifyPin(userId, pin);
  }

  isRequired() {
    return this.configService.get<boolean>("TRANSACTION_PIN_REQUIRED", false);
  }

  private assertValidPin(pin: string) {
    if (!/^\d{4,6}$/.test(pin)) {
      throw new BadRequestException("Transaction PIN must be 4 to 6 digits");
    }
  }

  private async recordFailure(userId: string) {
    const failuresKey = this.failuresKey(userId);
    const current = Number((await this.redis.get(failuresKey)) || "0");
    const next = current + 1;

    if (next >= MAX_FAILED_ATTEMPTS) {
      await this.redis.set(this.lockKey(userId), "1", LOCK_SECONDS);
      await this.redis.del(failuresKey);
      return;
    }

    await this.redis.set(failuresKey, String(next), LOCK_SECONDS);
  }

  private async clearFailures(userId: string) {
    await this.redis.del(this.failuresKey(userId));
    await this.redis.del(this.lockKey(userId));
  }

  private hashPin(pin: string, salt: string, iterations: number) {
    return pbkdf2Sync(pin, salt, iterations, 32, "sha256").toString(
      "base64url",
    );
  }

  private buildStoredPin(pin: string): StoredPin {
    const salt = randomBytes(16).toString("base64url");
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

  private lockKey(userId: string) {
    return `transaction-pin-lock:${userId}`;
  }

  private resetHoldKey(userId: string) {
    return `transaction-pin-reset-hold:${userId}`;
  }
}
