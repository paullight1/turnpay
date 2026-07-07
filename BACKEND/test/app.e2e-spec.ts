import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { RateService } from "../src/exchange/providers/rate.service";

describe("AppController (e2e)", () => {
  jest.setTimeout(30000);

  let app: INestApplication<App>;
  const api = () => request(app.getHttpAdapter().getInstance());

  const mockPrisma = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    setIfNotExists: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    isAvailable: jest.fn(),
    isRedisAvailable: jest.fn(),
    getMode: jest.fn(),
    getClient: jest.fn(),
  };

  const mockRateService = {
    getRate: jest.fn(),
    setManualRate: jest.fn(),
    getDeviationFromMarket: jest.fn(),
    getCircuitStatus: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(RedisService)
      .useValue(mockRedis)
      .overrideProvider(RateService)
      .useValue(mockRateService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it("/ (GET)", () => {
    return api()
      .get("/")
      .expect(200)
      .expect("Hello World!");
  });

  afterAll(async () => {
    await app?.close();
  });
});
