import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import IORedis from "ioredis";
import { PinoLogger } from "nestjs-pino";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: IORedis;
  private readonly memoryStore = new Map<
    string,
    { value: string; expiresAt?: number }
  >();

  constructor(
    private configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    const options = {
      retryStrategy: (times: number) => {
        if (times > 10) return null;
        return Math.min(times * 200, 2000);
      },
      maxRetriesPerRequest: 3,
    };
    const redisUrl = this.configService.get<string>("REDIS_URL");

    this.client = redisUrl
      ? new IORedis(redisUrl, options)
      : new IORedis({
          host: this.configService.get<string>("REDIS_HOST", "localhost"),
          port: this.configService.get<number>("REDIS_PORT", 6379),
          password: this.configService.get<string>("REDIS_PASSWORD", ""),
          ...options,
        });

    this.client.on("error", (err) => {
      this.logger.error({ err }, "Redis connection error");
    });

    this.client.on("connect", () => {
      this.logger.info({}, "Connected to Redis");
    });
  }

  async onModuleInit() {
    try {
      await this.client.ping();
      this.logger.info({}, "Redis server is reachable");
    } catch {
      this.logger.warn(
        {},
        "Redis server not reachable, falling back to memory storage",
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn({ err }, "Redis client was already closed");
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isRedisReady()) {
      return this.getFromMemory(key);
    }

    try {
      return await this.client.get(key);
    } catch {
      return this.getFromMemory(key);
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.isRedisReady()) {
      this.setInMemory(key, value, ttl);
      return;
    }

    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch {
      this.logger.warn({ key }, "Failed to set Redis key");
      this.setInMemory(key, value, ttl);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isRedisReady()) {
      this.memoryStore.delete(key);
      return;
    }

    try {
      await this.client.del(key);
    } catch {
      this.logger.warn({ key }, "Failed to delete Redis key");
      this.memoryStore.delete(key);
    }
  }

  async setIfNotExists(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!this.isRedisReady()) {
      return this.setInMemoryIfNotExists(key, value, ttlSeconds);
    }

    try {
      const result = await this.client.set(key, value, "EX", ttlSeconds, "NX");
      return result === "OK";
    } catch {
      this.logger.warn({ key }, "Failed to acquire Redis lock");
      return this.setInMemoryIfNotExists(key, value, ttlSeconds);
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isRedisReady()) {
      return this.getFromMemory(key) !== null;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch {
      return this.getFromMemory(key) !== null;
    }
  }

  getClient(): IORedis {
    return this.client;
  }

  isAvailable(): boolean {
    return true;
  }

  isRedisAvailable(): boolean {
    return this.isRedisReady();
  }

  getMode(): "redis" | "memory" {
    return this.isRedisReady() ? "redis" : "memory";
  }

  private isRedisReady(): boolean {
    return this.client.status === "ready";
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
}
