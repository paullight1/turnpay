import { BadRequestException, ConflictException } from '@nestjs/common';
import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

describe('IdempotencyInterceptor', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    setIfNotExists: jest.fn(),
    del: jest.fn(),
  };
  const prisma = {
    idempotencyRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const makeContext = (body: unknown) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/api/payments/fund',
          headers: { 'idempotency-key': 'idem-1' },
          user: { userId: 'user-1' },
          body,
        }),
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a warm Redis idempotency hit when the request body changed', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    redis.get.mockReturnValue(
      JSON.stringify({
        requestHash: 'different-hash',
        response: { reference: 'FUND-1' },
      }),
    );

    await expect(
      interceptor.intercept(makeContext({ amount: 200 }), {
        handle: () => of({ reference: 'FUND-2' }),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires idempotency key on protected mutation requests', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/api/payments/fund',
          headers: {},
          user: { userId: 'user-1' },
          body: { amount: 200 },
        }),
      }),
    } as any;

    await expect(
      interceptor.intercept(context, {
        handle: () => of({ reference: 'FUND-1' }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
