import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
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
    SMS_PROVIDER: 'twilio',
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

  const smsProvider = {
    sendSms: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.OTP_EXPIRES_IN = '5';
    configValues.OTP_LENGTH = '6';
    configValues.OTP_DEV_CODE = '654321';
    configValues.NODE_ENV = 'test';
    configValues.SMS_PROVIDER = 'twilio';
  });

  it('rejects a fourth OTP send in the same hour for one normalized phone', async () => {
    const { redis } = createRedisMock();
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      smsProvider,
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
      smsProvider,
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
      smsProvider,
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

  it('delivers an OTP before persisting the code and returns success only after delivery', async () => {
    const { redis, store } = createRedisMock();
    configValues.OTP_DEV_CODE = '';
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      smsProvider,
    );

    await expect(service.sendOtp('+2348012345678')).resolves.toEqual({
      success: true,
      message: 'OTP sent successfully',
    });

    expect(smsProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(smsProvider.sendSms).toHaveBeenCalledWith(
      '+2348012345678',
      expect.stringMatching(/^Your TrustPay verification code is: \d{6}\./),
    );
    expect(store.size).toBe(1);
  });

  it('does not persist a code or report success when SMS delivery fails', async () => {
    const { redis, store } = createRedisMock();
    configValues.OTP_DEV_CODE = '';
    smsProvider.sendSms.mockRejectedValueOnce(
      new ServiceUnavailableException('OTP delivery unavailable'),
    );
    const service = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      smsProvider,
    );

    await expect(service.sendOtp('+2348012345678')).rejects.toBeInstanceOf(
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
      smsProvider,
    );

    await service.sendOtp('+2348012345678');
    const stored = [...store.values()][0];
    expect(stored.expiresAt).toBeDefined();
    expect(stored.expiresAt! - Date.now()).toBeLessThanOrEqual(300_000);

    configValues.NODE_ENV = 'staging';
    configValues.OTP_DEV_CODE = '654321';
    const stagingService = new OtpService(
      redis as never,
      configService as never,
      logger as never,
      smsProvider,
    );
    await stagingService.sendOtp('+2348012345678');
    expect(smsProvider.sendSms).toHaveBeenLastCalledWith(
      '+2348012345678',
      expect.not.stringContaining('654321'),
    );

    configValues.OTP_EXPIRES_IN = '5';
    configValues.OTP_DEV_CODE = '654321';
    configValues.NODE_ENV = 'test';
  });
});
