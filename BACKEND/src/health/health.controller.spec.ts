import { ConfigService } from "@nestjs/config";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

describe("HealthController", () => {
  const prisma = {
    $queryRaw: jest.fn(),
  } as unknown as PrismaService;

  const redis = {
    isRedisAvailable: jest.fn(),
    getClient: jest.fn(),
  } as unknown as RedisService;

  const config = {
    get: jest.fn(),
  } as unknown as ConfigService;

  const controller = new HealthController(prisma, redis, config);

  beforeEach(() => {
    jest.clearAllMocks();
    config.get = jest.fn();
    redis.isRedisAvailable = jest.fn();
    redis.getClient = jest.fn();
    prisma.$queryRaw = jest.fn();
  });

  it("returns ok when the database and redis are reachable", async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ "1": 1 }]);
    redis.isRedisAvailable = jest.fn().mockReturnValue(true);
    redis.getClient = jest.fn().mockReturnValue({
      ping: jest.fn().mockResolvedValue("PONG"),
    });
    config.get = jest.fn().mockReturnValue("development");

    await expect(controller.check()).resolves.toEqual({
      status: "ok",
      checks: {
        database: "connected",
        redis: "connected",
      },
      timestamp: expect.any(String),
    });
  });

  it("falls back to memory mode in development when redis is unavailable", async () => {
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ "1": 1 }]);
    redis.isRedisAvailable = jest.fn().mockReturnValue(false);
    redis.getClient = jest.fn();
    config.get = jest.fn().mockReturnValue("development");

    await expect(controller.check()).resolves.toMatchObject({
      status: "ok",
      checks: {
        database: "connected",
        redis: "memory-fallback",
      },
    });
  });

  it("returns degraded when the database is unavailable or redis is down in production", async () => {
    prisma.$queryRaw = jest.fn().mockRejectedValue(new Error("db down"));
    redis.isRedisAvailable = jest.fn().mockReturnValue(false);
    redis.getClient = jest.fn();
    config.get = jest.fn().mockReturnValue("production");

    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
