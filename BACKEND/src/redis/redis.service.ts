import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import IORedis from "ioredis";
import { PinoLogger } from "nestjs-pino";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: IORedis;

  constructor(
    private configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.client = new IORedis({
      host: this.configService.get<string>("REDIS_HOST", "localhost"),
      port: this.configService.get<number>("REDIS_PORT", 6379),
      password: this.configService.get<string>("REDIS_PASSWORD", ""),
      retryStrategy: (times: number) => {
        if (times > 10) return null;
        return Math.min(times * 200, 2000);
      },
      maxRetriesPerRequest: 3,
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
    await this.client.quit();
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch {
      this.logger.warn({ key }, "Failed to set Redis key");
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      this.logger.warn({ key }, "Failed to delete Redis key");
    }
  }

  async setIfNotExists(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    try {
      const result = await this.client.set(key, value, "EX", ttlSeconds, "NX");
      return result === "OK";
    } catch {
      this.logger.warn({ key }, "Failed to acquire Redis lock");
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch {
      return false;
    }
  }

  getClient(): IORedis {
    return this.client;
  }

  isAvailable(): boolean {
    return this.client.status === "ready";
  }
}
