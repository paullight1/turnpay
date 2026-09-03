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
    KYC_PROVIDER: 'youverify',
    YOUVERIFY_API_KEY: 'test-youverify-api-key',
    YOUVERIFY_BASE_URL: 'https://api.youverify.co',
    YOUVERIFY_WEBHOOK_URL:
      'https://api.trustpay.example.com/api/webhooks/kyc/youverify',
    YOUVERIFY_WEBHOOK_SECRET: 'test-youverify-webhook-secret',
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

  it('reports Ninja ready without requiring a webhook configuration', async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);
    redis.isAvailable = jest.fn().mockReturnValue(true);
    redis.getClient = jest.fn().mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });
    const ninjaConfig: Record<string, string> = {
      KYC_PROVIDER: 'ninja',
      NINJA_CLIENT_KEY: 'test-ninja-client-key',
      NINJA_CLIENT_SECRET: 'test-ninja-client-secret',
      NINJA_BASE_URL: 'https://api.ninja.boucloud.io',
      PII_ENCRYPTION_KEY: 'test-pii-key-with-at-least-32-characters',
    };
    config.get = jest.fn((key: string) => ninjaConfig[key]);

    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ready',
      checks: { kyc: 'configured' },
    });
  });

  it('never reports Ninja ready for an arbitrary HTTPS host', async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);
    redis.isAvailable = jest.fn().mockReturnValue(true);
    redis.getClient = jest.fn().mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });
    const ninjaConfig: Record<string, string> = {
      KYC_PROVIDER: 'ninja',
      NINJA_CLIENT_KEY: 'test-ninja-client-key',
      NINJA_CLIENT_SECRET: 'test-ninja-client-secret',
      NINJA_BASE_URL: 'https://identity-attacker.example.com',
      PII_ENCRYPTION_KEY: 'test-pii-key-with-at-least-32-characters',
    };
    config.get = jest.fn((key: string) => ninjaConfig[key]);

    await expect(controller.ready()).rejects.toMatchObject({
      response: expect.objectContaining({
        checks: expect.objectContaining({ kyc: 'misconfigured' }),
      }),
    });
  });

  it('never reports ready when the Youverify webhook URL is missing', async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);
    redis.isAvailable = jest.fn().mockReturnValue(true);
    redis.getClient = jest.fn().mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });
    config.get = jest.fn((key: string) =>
      key === 'YOUVERIFY_WEBHOOK_URL' ? undefined : kycConfig[key],
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
});
