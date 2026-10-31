import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD, HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RedisThrottlerStorage } from '../common/services/redis-throttler.storage';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';

@Controller('ordinary')
class OrdinaryTestController {
  @Get() get() {
    return { status: 'ok' };
  }
}

describe('health endpoints with the real global rate limiter', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const redis = {
      isAvailable: () => false,
      isMemoryFallbackAllowed: () => false,
    };
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60000, limit: 120 }],
          storage: new RedisThrottlerStorage(redis as never),
        }),
      ],
      controllers: [HealthController, OrdinaryTestController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRaw: async () => [{ '1': 1 }] },
        },
        { provide: RedisService, useValue: redis },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            KYC_PROVIDER: 'paystack',
            PAYSTACK_SECRET_KEY: 'sk_test_fixture',
            PII_ENCRYPTION_KEY: 'test-only-key-longer-than-32-characters',
          }),
        },
        { provide: APP_GUARD, useClass: UserThrottlerGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(
      new AllExceptionsFilter(app.get(HttpAdapterHost), {
        log() {},
        error() {},
        warn() {},
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('keeps liveness reachable when Redis is down', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200);
    expect(response.body.status).toBe('ok');
  });
  it('returns dependency readiness details instead of a rate-limiter error', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503);
    expect(response.body).toMatchObject({
      statusCode: 503,
      message: {
        status: 'not_ready',
        checks: { database: 'connected', redis: 'disconnected' },
      },
    });
  });
  it('continues failing ordinary routes closed when distributed controls are unavailable', async () => {
    await request(app.getHttpServer()).get('/api/ordinary').expect(503);
  });
});
