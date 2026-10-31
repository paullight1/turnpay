import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { createHash, randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { EmailOtpProvider } from './email-otp.provider';

const OTP_SEND_LIMIT = 3;
const OTP_SEND_WINDOW_SECONDS = 60 * 60;
const PASSWORD_RESET_LIMIT = 3;
const PASSWORD_RESET_WINDOW_SECONDS = 60 * 60;
const DEFAULT_OTP_EXPIRY_SECONDS = 5 * 60;
const MAX_OTP_EXPIRY_SECONDS = 5 * 60;
const MAX_OTP_ATTEMPTS = 3;

const INCREMENT_WITH_TTL_SCRIPT = `
local total = redis.call("INCR", KEYS[1])
local ttlMs = redis.call("PTTL", KEYS[1])
if ttlMs <= 0 then
  redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[1]))
  ttlMs = tonumber(ARGV[1])
end
return { total, ttlMs }
`;

const VERIFY_OTP_SCRIPT = `
local code = redis.call("GET", KEYS[1])
if not code then
  return { "missing", 0 }
end
local attempts = tonumber(redis.call("GET", KEYS[2]) or "0")
if attempts >= tonumber(ARGV[2]) then
  redis.call("DEL", KEYS[1])
  redis.call("DEL", KEYS[2])
  return { "locked", attempts }
end
if code == ARGV[1] then
  redis.call("DEL", KEYS[1])
  redis.call("DEL", KEYS[2])
  return { "verified", attempts }
end
attempts = redis.call("INCR", KEYS[2])
local ttlMs = redis.call("PTTL", KEYS[1])
if ttlMs > 0 then
  redis.call("PEXPIRE", KEYS[2], ttlMs)
end
if attempts >= tonumber(ARGV[2]) then
  redis.call("DEL", KEYS[1])
  redis.call("DEL", KEYS[2])
  return { "exhausted", attempts }
end
return { "invalid", attempts }
`;

@Injectable()
export class OtpService {
  private readonly expirySeconds: number;
  private readonly devOtpCode?: string;
  private readonly maxAttempts = MAX_OTP_ATTEMPTS;
  private readonly localLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly emailProvider: EmailOtpProvider,
  ) {
    this.logger.setContext(OtpService.name);
    this.expirySeconds = this.parseExpirySeconds(
      this.configService.get<string>('OTP_EXPIRES_IN'),
    );
    const configuredDevCode = this.configService.get<string>('OTP_DEV_CODE');
    const nodeEnv = (
      this.configService.get<string>('NODE_ENV') ?? 'development'
    )
      .trim()
      .toLowerCase();
    this.devOtpCode =
      (nodeEnv === 'development' || nodeEnv === 'test') &&
      configuredDevCode &&
      /^\d{6}$/.test(configuredDevCode)
        ? configuredDevCode
        : undefined;
  }

  async assertOtpSendAllowed(phone: string): Promise<void> {
    const normalizedPhone = this.normalizeEmail(phone);
    const phoneHash = this.hashPhone(normalizedPhone);

    await this.enforceRateLimit(
      `otp-send:${phoneHash}`,
      OTP_SEND_WINDOW_SECONDS,
      OTP_SEND_LIMIT,
      'OTP requests are temporarily rate limited. Please try again later.',
    );
  }

  async assertPasswordResetAllowed(email: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const emailHash = this.hashIdentity(normalizedEmail);

    await this.enforceRateLimit(
      `password-reset:${emailHash}`,
      PASSWORD_RESET_WINDOW_SECONDS,
      PASSWORD_RESET_LIMIT,
      'Password reset requests are temporarily rate limited. Please try again later.',
    );
  }

  async startEmailChallenge(email: string): Promise<void> {
    const hash = this.hashIdentity(this.normalizeEmail(email));
    this.redis.assertAvailable();
    const codeKey = this.codeKey(hash);
    const attemptsKey = this.attemptsKey(hash);
    const challenge = this.devOtpCode ?? randomUUID();
    if (this.redis.isAvailable()) {
      await this.redis.execute('email-otp-start', (client) =>
        client.eval(
          `
        redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
        redis.call('DEL', KEYS[2])
        return 1
      `,
          2,
          codeKey,
          attemptsKey,
          challenge,
          String(this.expirySeconds),
        ),
      );
    } else {
      await this.withLocalLock(codeKey, async () => {
        await this.redis.set(codeKey, challenge, this.expirySeconds);
        await this.redis.del(attemptsKey);
      });
    }
  }

  async sendOtp(email: string): Promise<{ success: boolean; message: string }> {
    const normalizedEmail = this.normalizeEmail(email);
    this.redis.assertAvailable();
    if (!this.devOtpCode) await this.emailProvider.sendOtp(normalizedEmail);
    await this.startEmailChallenge(normalizedEmail);
    this.logger.info(
      {
        identityHash: this.hashIdentity(normalizedEmail),
        expiresInSeconds: this.expirySeconds,
      },
      'Email OTP requested',
    );
    return { success: true, message: 'OTP sent successfully' };
  }

  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const normalizedPhone = this.normalizeEmail(phone);
    const normalizedOtp = otp.trim();
    const phoneHash = this.hashPhone(normalizedPhone);
    const phoneMasked = '[email]';
    this.redis.assertAvailable();
    if (!this.devOtpCode)
      return this.verifyEmailChallenge(normalizedPhone, normalizedOtp);
    const result = this.redis.isAvailable()
      ? await this.verifyWithRedis(phoneHash, normalizedOtp)
      : await this.withLocalLock(`otp:${phoneHash}`, async () =>
          this.verifyWithLocalState(phoneHash, normalizedOtp),
        );

    if (result === 'verified') {
      this.logger.info({ phoneHash, phoneMasked }, 'OTP verified successfully');
      return true;
    }

    if (result === 'invalid') {
      const attempts = await this.readAttempts(phoneHash);
      this.logger.warn(
        {
          phoneHash,
          phoneMasked,
          attempt: attempts,
          maxAttempts: this.maxAttempts,
        },
        'Invalid OTP submitted',
      );
      return false;
    }

    if (result === 'locked' || result === 'exhausted') {
      this.logger.warn(
        { phoneHash, phoneMasked },
        'Maximum OTP verification attempts exceeded',
      );
      return false;
    }

    this.logger.warn({ phoneHash, phoneMasked }, 'OTP not found');
    return false;
  }

  private async verifyEmailChallenge(
    email: string,
    token: string,
  ): Promise<boolean> {
    const hash = this.hashIdentity(email);
    const codeKey = this.codeKey(hash);
    const attemptsKey = this.attemptsKey(hash);
    const challenge = this.redis.isAvailable()
      ? await this.redis.execute('email-otp-reserve', (client) =>
          client.eval(
            `
        local challenge = redis.call('GET', KEYS[1])
        if not challenge then return '' end
        local attempts = tonumber(redis.call('GET', KEYS[2]) or '0')
        if attempts >= 3 then return '' end
        redis.call('INCR', KEYS[2])
        redis.call('PEXPIRE', KEYS[2], redis.call('PTTL', KEYS[1]))
        return challenge
      `,
            2,
            codeKey,
            attemptsKey,
          ),
        )
      : await this.withLocalLock(codeKey, async () => {
          const value = await this.redis.get(codeKey);
          const attempts = Number((await this.redis.get(attemptsKey)) || '0');
          if (!value || attempts >= 3) return '';
          await this.redis.set(
            attemptsKey,
            String(attempts + 1),
            this.expirySeconds,
          );
          return value;
        });
    if (typeof challenge !== 'string' || !challenge) return false;
    if (!(await this.emailProvider.verifyOtp(email, token))) return false;
    // Compare the challenge generation so a late result cannot consume a resend.
    const consumed = this.redis.isAvailable()
      ? await this.redis.execute('email-otp-consume', (client) =>
          client.eval(
            `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('DEL', KEYS[1], KEYS[2])
        return 1
      `,
            2,
            codeKey,
            attemptsKey,
            challenge,
          ),
        )
      : await this.withLocalLock(codeKey, async () => {
          if ((await this.redis.get(codeKey)) !== challenge) return 0;
          await this.redis.del(codeKey);
          await this.redis.del(attemptsKey);
          return 1;
        });
    return Number(consumed) === 1;
  }

  private parseExpirySeconds(configured?: string): number {
    const value = configured?.trim().toLowerCase();
    if (!value) return DEFAULT_OTP_EXPIRY_SECONDS;

    const match = /^(\d+)(s|m)?$/.exec(value);
    if (!match) return DEFAULT_OTP_EXPIRY_SECONDS;

    const amount = Number(match[1]);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return DEFAULT_OTP_EXPIRY_SECONDS;
    }

    const seconds = match[2] === 's' ? amount : amount * 60;
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      return DEFAULT_OTP_EXPIRY_SECONDS;
    }

    return Math.min(seconds, MAX_OTP_EXPIRY_SECONDS);
  }

  private async enforceRateLimit(
    key: string,
    ttlSeconds: number,
    limit: number,
    message: string,
  ) {
    this.redis.assertAvailable();
    const total = this.redis.isAvailable()
      ? await this.incrementWithRedis(key, ttlSeconds)
      : await this.withLocalLock(key, async () =>
          this.incrementWithLocalState(key, ttlSeconds),
        );

    if (total > limit) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async incrementWithRedis(key: string, ttlSeconds: number) {
    const result = (await this.redis.execute('otp-rate-limit', (client) =>
      client.eval(INCREMENT_WITH_TTL_SCRIPT, 1, key, String(ttlSeconds * 1000)),
    )) as [number, number];

    return Number(result[0]);
  }

  private async incrementWithLocalState(key: string, ttlSeconds: number) {
    const current = Number((await this.redis.get(key)) || '0') + 1;
    await this.redis.set(key, String(current), ttlSeconds);
    return current;
  }

  private async verifyWithRedis(
    phoneHash: string,
    otp: string,
  ): Promise<'missing' | 'invalid' | 'verified' | 'locked' | 'exhausted'> {
    const result = (await this.redis.execute('otp-verify', (client) =>
      client.eval(
        VERIFY_OTP_SCRIPT,
        2,
        this.codeKey(phoneHash),
        this.attemptsKey(phoneHash),
        otp,
        String(this.maxAttempts),
      ),
    )) as [string, number];

    return result[0] as
      | 'missing'
      | 'invalid'
      | 'verified'
      | 'locked'
      | 'exhausted';
  }

  private async verifyWithLocalState(
    phoneHash: string,
    otp: string,
  ): Promise<'missing' | 'invalid' | 'verified' | 'locked' | 'exhausted'> {
    const codeKey = this.codeKey(phoneHash);
    const attemptsKey = this.attemptsKey(phoneHash);
    const code = await this.redis.get(codeKey);

    if (!code) {
      return 'missing';
    }

    const attempts = Number((await this.redis.get(attemptsKey)) || '0');
    if (attempts >= this.maxAttempts) {
      await this.redis.del(codeKey);
      await this.redis.del(attemptsKey);
      return 'locked';
    }

    if (code === otp) {
      await this.redis.del(codeKey);
      await this.redis.del(attemptsKey);
      return 'verified';
    }

    const nextAttempts = attempts + 1;
    await this.redis.set(attemptsKey, String(nextAttempts), this.expirySeconds);
    if (nextAttempts >= this.maxAttempts) {
      await this.redis.del(codeKey);
      await this.redis.del(attemptsKey);
      return 'exhausted';
    }

    return 'invalid';
  }

  private async readAttempts(phoneHash: string) {
    return Number((await this.redis.get(this.attemptsKey(phoneHash))) || '0');
  }

  private codeKey(phoneHash: string) {
    return `otp:${phoneHash}:code`;
  }

  private attemptsKey(phoneHash: string) {
    return `otp:${phoneHash}:attempts`;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private hashPhone(phone: string): string {
    return this.hashIdentity(phone);
  }

  private hashIdentity(value: string) {
    return createHash('sha256').update(value).digest('hex');
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
