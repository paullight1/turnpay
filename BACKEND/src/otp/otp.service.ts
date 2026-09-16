import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { createHash, randomInt } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { maskPhone } from '../common/utils/masking';
import { SMS_PROVIDER } from './sms-provider';
import type { SmsProvider } from './sms-provider';

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
  private readonly otpLength: number;
  private readonly devOtpCode?: string;
  private readonly maxAttempts = MAX_OTP_ATTEMPTS;
  private readonly localLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {
    this.logger.setContext(OtpService.name);
    this.expirySeconds = this.parseExpirySeconds(
      this.configService.get<string>('OTP_EXPIRES_IN'),
    );
    const configuredOtpLength = Number(
      this.configService.get<string>('OTP_LENGTH') || '6',
    );
    // The public DTO accepts six digits. Fall back to that contract when a
    // malformed or incompatible value is supplied instead of generating an
    // OTP that the API cannot verify.
    this.otpLength = configuredOtpLength === 6 ? configuredOtpLength : 6;
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
    const normalizedPhone = this.normalizePhone(phone);
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

  async sendOtp(phone: string): Promise<{ success: boolean; message: string }> {
    const normalizedPhone = this.normalizePhone(phone);
    const code = this.devOtpCode ?? this.generateOtp();
    const phoneHash = this.hashPhone(normalizedPhone);
    const codeKey = this.codeKey(phoneHash);
    const attemptsKey = this.attemptsKey(phoneHash);
    const message = `Your TrustPay verification code is: ${code}. Valid for ${Math.ceil(this.expirySeconds / 60)} minutes.`;

    if (!this.devOtpCode) {
      try {
        await this.smsProvider.sendSms(normalizedPhone, message);
      } catch (error: unknown) {
        this.logger.warn(
          {
            phoneHash,
            phoneMasked: maskPhone(normalizedPhone),
          },
          'OTP delivery failed',
        );
        if (error instanceof HttpException) {
          throw error;
        }
        throw new ServiceUnavailableException('OTP delivery unavailable');
      }
    }

    // Persist only after the provider acknowledges the request. This avoids
    // leaving a newly generated code usable when delivery fails or times out.
    await this.redis.set(codeKey, code, this.expirySeconds);
    await this.redis.del(attemptsKey);

    this.logger.info(
      {
        phoneHash,
        phoneMasked: maskPhone(normalizedPhone),
        expiresInSeconds: this.expirySeconds,
      },
      'OTP generated',
    );
    if (this.devOtpCode) {
      this.logger.warn('Development OTP override is enabled');
    }

    return {
      success: true,
      message: 'OTP sent successfully',
    };
  }

  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedOtp = otp.trim();
    const phoneHash = this.hashPhone(normalizedPhone);
    const phoneMasked = maskPhone(normalizedPhone);
    this.redis.assertAvailable();
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

  private generateOtp(): string {
    const min = Math.pow(10, this.otpLength - 1);
    const max = Math.pow(10, this.otpLength) - 1;
    return String(randomInt(min, max + 1));
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

  private normalizePhone(phone: string) {
    return phone.trim();
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
