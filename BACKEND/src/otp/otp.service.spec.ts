import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OtpService } from './otp.service';
import { EmailOtpProvider } from './email-otp.provider';

type StoredValue = {
  value: string;
  expiresAt?: number;
};

function createRedisMock() {
  const store = new Map<string, StoredValue>();

  const read = (key: string) => {
    const item = store.get(key);
    if (!item) {
      return null;
    }

    if (item.expiresAt && item.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }

    return item.value;
  };

  return {
    store,
    redis: {
      get: jest.fn(async (key: string) => read(key)),
      set: jest.fn(async (key: string, value: string, ttl?: number) => {
        store.set(key, {
          value,
          expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
        });
      }),
      del: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      isRedisAvailable: jest.fn(() => false),
      isAvailable: jest.fn(() => false),
      isMemoryFallbackAllowed: jest.fn(() => true),
      assertAvailable: jest.fn(),
      getClient: jest.fn(),
    },
  };
}

describe('OtpService', () => {
  const configValues = {
    OTP_EXPIRES_IN: '5',
    OTP_LENGTH: '6',
    OTP_DEV_CODE: '654321',
    NODE_ENV: 'test',
    OTP_PROVIDER: 'supabase_email',
  };

  const configService = {
    get: jest.fn(
      (key: string) => configValues[key as keyof typeof configValues],
    ),
  };

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };

  const emailProvider = {
    sendOtp: jest.fn().mockResolvedValue(undefined),
    verifyOtp: jest.fn().mockResolvedValue(false),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    emailProvider.verifyOtp.mockReset().mockResolvedValue(false);
    configValues.OTP_EXPIRES_IN = '5';
    configValues.OTP_LENGTH = '6';
    configValues.OTP_DEV_CODE = '654321';
    configValues.NODE_ENV = 'test';
    configValues.OTP_PROVIDER = 'supabase_email';
  });

  it('rejects a fourth OTP send in the same hour for one normalized email', async () => {
    const { redis } = createRedisMock();
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as unknown as EmailOtpProvider,
    );

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        service.assertOtpSendAllowed(' ada@example.com '),
      ),
    );

    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(3);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(HttpException);
    expect((rejected?.reason as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('rejects a fourth password reset request in the same hour for one normalized email', async () => {
    const { redis } = createRedisMock();
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as unknown as EmailOtpProvider,
    );

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        service.assertPasswordResetAllowed(' Ada@Example.com '),
      ),
    );

    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(3);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(HttpException);
    expect((rejected?.reason as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('does not let concurrent invalid OTP submissions preserve a usable code', async () => {
    const { redis } = createRedisMock();
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as unknown as EmailOtpProvider,
    );

    await service.sendOtp('ada@example.com');

    const invalidAttempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.verifyOtp('ada@example.com', '111111'),
      ),
    );

    expect(invalidAttempts).toEqual([false, false, false, false]);
    await expect(service.verifyOtp('ada@example.com', '654321')).resolves.toBe(
      false,
    );
  });

  it('delivers an OTP before persisting the code and returns success only after delivery', async () => {
    const { redis, store } = createRedisMock();
    configValues.OTP_DEV_CODE = '';
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as unknown as EmailOtpProvider,
    );

    await expect(service.sendOtp('ada@example.com')).resolves.toEqual({
      success: true,
      message: 'OTP sent successfully',
    });

    expect(emailProvider.sendOtp).toHaveBeenCalledTimes(1);
    expect(emailProvider.sendOtp).toHaveBeenCalledWith('ada@example.com');
    expect(store.size).toBe(1);
  });

  it('does not persist a code or report success when email delivery fails', async () => {
    const { redis, store } = createRedisMock();
    configValues.OTP_DEV_CODE = '';
    emailProvider.sendOtp.mockRejectedValueOnce(
      new ServiceUnavailableException('OTP delivery unavailable'),
    );
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as unknown as EmailOtpProvider,
    );

    await expect(service.sendOtp('ada@example.com')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(store.size).toBe(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      'OTP generated',
    );
  });

  it('clamps configured expiry to five minutes and allows the development override only locally', async () => {
    const { redis, store } = createRedisMock();
    configValues.OTP_EXPIRES_IN = '15m';
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as unknown as EmailOtpProvider,
    );

    await service.sendOtp('ada@example.com');
    const stored = [...store.values()][0];
    expect(stored.expiresAt).toBeDefined();
    expect(stored.expiresAt! - Date.now()).toBeLessThanOrEqual(300_000);

    configValues.NODE_ENV = 'staging';
    configValues.OTP_DEV_CODE = '654321';
    const stagingService = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as unknown as EmailOtpProvider,
    );
    await stagingService.sendOtp('ada@example.com');
    expect(emailProvider.sendOtp).toHaveBeenLastCalledWith('ada@example.com');

    configValues.OTP_EXPIRES_IN = '5';
    configValues.OTP_DEV_CODE = '654321';
    configValues.NODE_ENV = 'test';
  });
  it('limits provider verification to three attempts and never accepts an expired challenge', async () => {
    const { redis } = createRedisMock();
    configValues.OTP_DEV_CODE = '';
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as never,
    );
    await service.sendOtp(' Ada@Example.com ');
    await Promise.all(
      Array.from({ length: 5 }, () =>
        service.verifyOtp('ada@example.com', '111111'),
      ),
    );
    expect(emailProvider.verifyOtp).toHaveBeenCalledTimes(3);
    emailProvider.verifyOtp.mockResolvedValueOnce(true);
    await expect(service.verifyOtp('ada@example.com', '123456')).resolves.toBe(
      false,
    );
    expect(emailProvider.verifyOtp).toHaveBeenCalledTimes(3);
  });

  it('expires an emailed challenge after five minutes even if the upstream token remains valid', async () => {
    jest.useFakeTimers();
    try {
      const { redis } = createRedisMock();
      configValues.OTP_DEV_CODE = '';
      const service = new OtpService(
        redis as never,
        configService as never,
        logger as never,
        emailProvider as never,
      );
      await service.sendOtp('ada@example.com');
      jest.advanceTimersByTime(300_001);
      await expect(
        service.verifyOtp('ada@example.com', '123456'),
      ).resolves.toBe(false);
      expect(emailProvider.verifyOtp).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('consumes a successful emailed challenge once and does not store the provider code', async () => {
    const { redis, store } = createRedisMock();
    configValues.OTP_DEV_CODE = '';
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      emailProvider as never,
    );
    await service.sendOtp('ada@example.com');
    expect([...store.values()].every((item) => item.value !== '123456')).toBe(
      true,
    );
    emailProvider.verifyOtp.mockResolvedValue(true);
    const results = await Promise.all([
      service.verifyOtp('ada@example.com', '123456'),
      service.verifyOtp('ada@example.com', '123456'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
