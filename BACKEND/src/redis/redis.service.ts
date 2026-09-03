import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: IORedis;
  private readonly allowMemoryFallback: boolean;
  private readonly memoryStore = new Map<
    string,
    { value: string; expiresAt?: number }
  >();

  constructor(
    private configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const configuredFallback = this.configService.get<boolean | string>(
      'REDIS_ALLOW_MEMORY_FALLBACK',
      false,
    );
    this.allowMemoryFallback =
      (nodeEnv === 'development' || nodeEnv === 'test') &&
      (configuredFallback === true || configuredFallback === 'true');

    const options = {
      retryStrategy: (times: number) => {
        if (times > 10) return null;
        return Math.min(times * 200, 2000);
      },
      maxRetriesPerRequest: 3,
    };
    const redisUrl = this.configService.get<string>('REDIS_URL');

    this.client = redisUrl
      ? new IORedis(redisUrl, options)
      : new IORedis({
          host: this.configService.get<string>('REDIS_HOST', 'localhost'),
          port: this.configService.get<number>('REDIS_PORT', 6379),
          password: this.configService.get<string>('REDIS_PASSWORD', ''),
          ...options,
        });

    this.client.on('error', (err) => {
      this.logger.error({ err }, 'Redis connection error');
    });

    this.client.on('connect', () => {
      this.logger.info({}, 'Connected to Redis');
    });

    this.client.on('close', () => {
      this.logger.error(
        {
          alertCode: 'REDIS_READINESS_REMOVED',
          redisMode: this.getMode(),
        },
        'Redis connection closed; readiness removed',
      );
    });
  }

  async onModuleInit() {
    try {
      await this.client.ping();
      this.logger.info({}, 'Redis server is reachable');
    } catch (error) {
      if (!this.allowMemoryFallback) {
        this.logger.error(
          { err: this.describeError(error) },
          'Redis is required but unavailable during startup',
        );
        throw this.unavailable();
      }
      this.logger.warn(
        {},
        'Redis unavailable; explicit local memory mode active',
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Redis client was already closed');
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isRedisReady()) {
      return this.withMemoryFallback(() => this.getFromMemory(key));
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      this.logCommandFailure('get', error);
      return this.withMemoryFallback(() => this.getFromMemory(key));
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.isRedisReady()) {
      return this.withMemoryFallback(() => this.setInMemory(key, value, ttl));
    }

    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logCommandFailure('set', error);
      return this.withMemoryFallback(() => this.setInMemory(key, value, ttl));
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isRedisReady()) {
      return this.withMemoryFallback(() => {
        this.memoryStore.delete(key);
      });
    }

    try {
      await this.client.del(key);
    } catch (error) {
      this.logCommandFailure('delete', error);
      return this.withMemoryFallback(() => {
        this.memoryStore.delete(key);
      });
    }
  }

  async setIfNotExists(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!this.isRedisReady()) {
      return this.withMemoryFallback(() =>
        this.setInMemoryIfNotExists(key, value, ttlSeconds),
      );
    }

    try {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logCommandFailure('set-if-not-exists', error);
      return this.withMemoryFallback(() =>
        this.setInMemoryIfNotExists(key, value, ttlSeconds),
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isRedisReady()) {
      return this.withMemoryFallback(() => this.getFromMemory(key) !== null);
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logCommandFailure('exists', error);
      return this.withMemoryFallback(() => this.getFromMemory(key) !== null);
    }
  }

  getClient(): IORedis {
    return this.client;
  }

  async execute<T>(
    command: string,
    operation: (client: IORedis) => Promise<T>,
  ): Promise<T> {
    if (!this.isRedisReady()) {
      throw this.unavailable();
    }
    try {
      return await operation(this.client);
    } catch (error) {
      this.logCommandFailure(command, error);
      throw this.unavailable();
    }
  }

  isAvailable(): boolean {
    return this.isRedisReady();
  }

  isRedisAvailable(): boolean {
    return this.isRedisReady();
  }

  isMemoryFallbackAllowed(): boolean {
    return this.allowMemoryFallback;
  }

  assertAvailable(): void {
    if (!this.isRedisReady() && !this.allowMemoryFallback) {
      throw this.unavailable();
    }
  }

  reportOperationalAlert(
    alertCode: string,
    context: Record<string, string | number | boolean> = {},
  ): void {
    this.logger.warn(
      { alertCode, ...context },
      'Operational alert threshold reached',
    );
  }

  getMode(): 'redis' | 'memory' | 'unavailable' {
    if (this.isRedisReady()) return 'redis';
    return this.allowMemoryFallback ? 'memory' : 'unavailable';
  }

  private isRedisReady(): boolean {
    return this.client.status === 'ready';
  }

  private getFromMemory(key: string): string | null {
    const item = this.memoryStore.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt <= Date.now()) {
      this.memoryStore.delete(key);
      return null;
    }
    return item.value;
  }

  private setInMemory(key: string, value: string, ttl?: number) {
    this.memoryStore.set(key, {
      value,
      expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
    });
  }

  private setInMemoryIfNotExists(
    key: string,
    value: string,
    ttlSeconds: number,
  ): boolean {
    if (this.getFromMemory(key) !== null) {
      return false;
    }
    this.setInMemory(key, value, ttlSeconds);
    return true;
  }

  private withMemoryFallback<T>(operation: () => T): T {
    if (!this.allowMemoryFallback) {
      throw this.unavailable();
    }
    return operation();
  }

  private unavailable() {
    return new ServiceUnavailableException({
      statusCode: 503,
      code: 'DISTRIBUTED_CONTROLS_UNAVAILABLE',
      message: 'Distributed controls unavailable',
    });
  }

  private logCommandFailure(command: string, error: unknown) {
    this.logger.error(
      { command, err: this.describeError(error) },
      'Redis command failed',
    );
  }

  private describeError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
