import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';

describe('HealthController', () => {
  const prisma = {
    $queryRaw: jest.fn(),
  };

  const redis = {
    isAvailable: jest.fn(),
    getClient: jest.fn(),
  };
  const kycConfig: Record<string, string> = {
    KYC_PROVIDER: 'monnify',
    MONNIFY_API_KEY: 'test-monnify-api-key',
    MONNIFY_SECRET_KEY: 'test-monnify-secret-key',
    MONNIFY_BASE_URL: 'https://api.monnify.com',
    PII_ENCRYPTION_KEY: 'test-pii-key-with-at-least-32-characters',
  };
  const config = {
    get: jest.fn<string | undefined, [string]>((key) => kycConfig[key]),
  };

  const controller = new HealthController(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    config as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    redis.isAvailable = jest.fn();
    redis.getClient = jest.fn();
    prisma.$queryRaw = jest.fn();
    config.get = jest.fn((key: string) => kycConfig[key]);
  });

  it('reports process liveness without probing dependencies', () => {
    expect(controller.live()).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.getClient).not.toHaveBeenCalled();
  });

  it('returns ready when the database and redis are reachable', async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);
    redis.isAvailable = jest.fn().mockReturnValue(true);
    redis.getClient = jest.fn().mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });

    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      checks: {
        database: 'connected',
        redis: 'connected',
        kyc: 'configured',
      },
      timestamp: expect.any(String),
    });
  });

  it('reports Monnify ready with valid server credentials and HTTPS URL', async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);
    redis.isAvailable = jest.fn().mockReturnValue(true);
    redis.getClient = jest.fn().mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });

    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ready',
      checks: { kyc: 'configured' },
    });
  });

  it('rejects retired KYC providers from readiness', async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);
    redis.isAvailable = jest.fn().mockReturnValue(true);
    redis.getClient = jest.fn().mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });
    config.get = jest.fn((key: string) =>
      key === 'KYC_PROVIDER' ? 'ninja' : kycConfig[key],
    );

    await expect(controller.ready()).rejects.toMatchObject({
      response: expect.objectContaining({
        checks: expect.objectContaining({ kyc: 'misconfigured' }),
      }),
    });
  });

  it('never reports ready while Redis is in memory mode', async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);
    redis.isAvailable = jest.fn().mockReturnValue(false);
    redis.getClient = jest.fn();
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns degraded when the database is unavailable or redis is down in production', async () => {
    prisma.$queryRaw = jest.fn().mockRejectedValue(new Error('db down'));
    redis.isAvailable = jest.fn().mockReturnValue(false);
    redis.getClient = jest.fn();
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('returns not_ready within two seconds when dependency probes hang', async () => {
    jest.useFakeTimers();
    try {
      prisma.$queryRaw = jest.fn(() => new Promise(() => {}));
      redis.isAvailable = jest.fn().mockReturnValue(true);
      redis.getClient = jest
        .fn()
        .mockReturnValue({ ping: () => new Promise(() => {}) });
      const checked = expect(controller.ready()).rejects.toMatchObject({
        response: {
          status: 'not_ready',
          checks: { database: 'disconnected', redis: 'disconnected' },
        },
      });
      await jest.advanceTimersByTimeAsync(2000);
      // A broken deadline must fail this test rather than leave it waiting forever.
      let complete = false;
      void checked.then(() => {
        complete = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(complete).toBe(true);
      await checked;
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares a stalled database probe across concurrent health requests', async () => {
    jest.useFakeTimers();
    try {
      const localController = new HealthController(
        prisma as never,
        redis as never,
        config as never,
      );
      prisma.$queryRaw = jest.fn(() => new Promise(() => {}));
      redis.isAvailable = jest.fn().mockReturnValue(false);
      const first = localController.ready().catch(() => undefined);
      const second = localController.ready().catch(() => undefined);
      await Promise.resolve();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(2000);
      await Promise.all([first, second]);
    } finally {
      jest.useRealTimers();
    }
  });
});
