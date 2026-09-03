import { HttpException, HttpStatus } from '@nestjs/common';
import { OtpService } from './otp.service';

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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a fourth OTP send in the same hour for one normalized phone', async () => {
    const { redis } = createRedisMock();
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
    );

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        service.assertOtpSendAllowed(' +2348012345678 '),
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
    );

    await service.sendOtp('+2348012345678');

    const invalidAttempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.verifyOtp('+2348012345678', '111111'),
      ),
    );

    expect(invalidAttempts).toEqual([false, false, false, false]);
    await expect(service.verifyOtp('+2348012345678', '654321')).resolves.toBe(
      false,
    );
  });
});
