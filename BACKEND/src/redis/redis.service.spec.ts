import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from './redis.service';

const mockClient = {
  status: 'end',
  on: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => mockClient),
}));

describe('RedisService deployment policy', () => {
  const eventHandlers = new Map<string, (...args: unknown[]) => void>();
  const loggerError = jest.fn();
  const logger = {
    error: loggerError,
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;

  const createService = (
    values: Record<string, string | boolean | number | undefined>,
  ) => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        values[key] === undefined ? fallback : values[key],
      ),
    } as unknown as ConfigService;
    return new RedisService(config, logger);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.status = 'end';
    mockClient.on.mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers.set(event, handler);
        return mockClient;
      },
    );
    eventHandlers.clear();
    mockClient.ping.mockRejectedValue(new Error('connection refused'));
    mockClient.quit.mockResolvedValue('OK');
  });

  it.each(['production', 'staging'])(
    'fails %s startup when Redis is unavailable',
    async (nodeEnv) => {
      const service = createService({
        NODE_ENV: nodeEnv,
        REDIS_URL: 'redis://redis:6379',
        REDIS_ALLOW_MEMORY_FALLBACK: false,
      });

      await expect(service.onModuleInit()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(service.get('otp:test')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(service.isAvailable()).toBe(false);
    },
  );

  it('requires explicit opt-in before development memory fallback', async () => {
    const service = createService({
      NODE_ENV: 'development',
      REDIS_ALLOW_MEMORY_FALLBACK: false,
    });

    await expect(service.onModuleInit()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('allows memory fallback only with explicit development opt-in', async () => {
    const service = createService({
      NODE_ENV: 'development',
      REDIS_ALLOW_MEMORY_FALLBACK: true,
    });

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    await service.set('otp:test', '123456', 60);
    await expect(service.get('otp:test')).resolves.toBe('123456');
    expect(service.isAvailable()).toBe(false);
    expect(service.isMemoryFallbackAllowed()).toBe(true);
    expect(service.getMode()).toBe('memory');
  });

  it('fails closed when a deployed Redis command errors after startup', async () => {
    const service = createService({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis:6379',
      REDIS_ALLOW_MEMORY_FALLBACK: false,
    });
    mockClient.status = 'ready';
    mockClient.ping.mockResolvedValue('PONG');
    mockClient.setex.mockRejectedValue(new Error('socket closed'));

    await service.onModuleInit();
    await expect(
      service.set('transaction-pin-lock:user-1', '1', 60),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('emits an operational alert event when Redis readiness is removed', () => {
    createService({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis:6379',
      REDIS_ALLOW_MEMORY_FALLBACK: false,
    });

    eventHandlers.get('close')?.();

    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ alertCode: 'REDIS_READINESS_REMOVED' }),
      'Redis connection closed; readiness removed',
    );
  });
});
