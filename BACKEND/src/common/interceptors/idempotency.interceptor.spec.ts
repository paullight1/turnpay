import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

describe('IdempotencyInterceptor', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    setIfNotExists: jest.fn(),
    del: jest.fn(),
    isAvailable: jest.fn(),
  };
  const prisma = {
    idempotencyRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const responseCrypto = {
    fingerprintRequest: jest.fn(
      (body) =>
        `hmac:test:${createHash('sha256')
          .update(JSON.stringify(body ?? {}))
          .digest('hex')}`,
    ),
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  };

  const makeContext = (
    body: unknown,
    overrides: {
      method?: string;
      path?: string;
      headers?: Record<string, string>;
    } = {},
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: overrides.method ?? 'POST',
          originalUrl: overrides.path ?? '/api/payments/fund',
          headers: overrides.headers ?? { 'idempotency-key': 'idem-1' },
          user: { userId: 'user-1' },
          body,
        }),
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.isAvailable.mockReturnValue(false);
    redis.get.mockResolvedValue(null);
    prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
    prisma.idempotencyRecord.create.mockResolvedValue({ id: 'idem-record-1' });
    prisma.idempotencyRecord.update.mockResolvedValue({});
    prisma.idempotencyRecord.updateMany.mockResolvedValue({ count: 1 });
    prisma.idempotencyRecord.delete.mockResolvedValue({});
    responseCrypto.encrypt.mockReturnValue({
      responseCiphertext: 'ciphertext',
      responseIv: 'iv',
      responseTag: 'tag',
      encryptionKeyId: 'v1',
    });
    responseCrypto.decrypt.mockReturnValue({
      session: { access_token: 'access', refresh_token: 'refresh' },
    });
  });

  const hashBody = (body: unknown) =>
    `business:v2:${createHash('sha256')
      .update(JSON.stringify(body ?? {}))
      .digest('hex')}`;

  it('rejects a warm Redis idempotency hit when the request body changed', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    redis.get.mockResolvedValue(
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

  it('logs only a short digest when an idempotency key is replayed', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const rawKey = 'raw-retry-key-that-must-never-be-logged';
    const requestBody = { amount: '200.00' };
    redis.get.mockResolvedValue(
      JSON.stringify({
        requestHash: hashBody(requestBody),
        response: { reference: 'FUND-1' },
      }),
    );

    const result = await interceptor.intercept(
      makeContext(requestBody, {
        headers: { 'x-idempotency-key': rawKey },
      }),
      { handle: () => of({ reference: 'should-not-run' }) },
    );

    await expect(lastValueFrom(result)).resolves.toEqual({
      reference: 'FUND-1',
    });
    const serializedLogs = JSON.stringify(logger.info.mock.calls);
    expect(serializedLogs).not.toContain(rawKey);
    expect(serializedLogs).toContain(
      createHash('sha256').update(rawKey).digest('hex').slice(0, 12),
    );
  });

  it('replays financial business requests when only the already-verified PIN changed', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    let completed: any;
    let requestHash: string;
    prisma.idempotencyRecord.create.mockImplementationOnce(async ({ data }) => {
      requestHash = data.requestHash;
      return { id: 'idem-record-1' };
    });
    prisma.idempotencyRecord.update.mockImplementationOnce(async ({ data }) => {
      completed = { ...data, requestHash };
      return data;
    });
    const first = await interceptor.intercept(
      makeContext({ amount: '100.00', transactionPin: '1234' }),
      { handle: () => of({ reference: 'original' }) },
    );
    await lastValueFrom(first);
    prisma.idempotencyRecord.findUnique.mockImplementationOnce(
      async () => completed,
    );
    const retry = await interceptor.intercept(
      makeContext({ amount: '100.00', transactionPin: '5678' }),
      { handle: () => of({ reference: 'duplicate' }) },
    );
    await expect(lastValueFrom(retry)).resolves.toEqual({
      reference: 'original',
    });
  });

  it('keeps retired secret-bearing attempts blocked without redispatching the handler', async () => {
    prisma.idempotencyRecord.findUnique.mockResolvedValueOnce({
      status: 'COMPLETED',
      requestHash: 'legacy-retired:old-row',
      response: { reference: 'legacy-withdrawal' },
    });
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const handler = jest.fn(() => of({ reference: 'duplicate' }));
    await expect(
      interceptor.intercept(makeContext({ amount: '100' }), {
        handle: handler,
      }),
    ).rejects.toThrow('status');
    expect(handler).not.toHaveBeenCalled();
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

  it('requires idempotency keys for explicitly classified auth mutations', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
      responseCrypto as any,
    );

    await expect(
      interceptor.intercept(
        makeContext(
          { pin: '1234' },
          {
            path: '/api/auth/transaction-pin',
            headers: {},
          },
        ),
        { handle: () => of({ success: true }) },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores token-bearing auth responses only in encrypted fields', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
      responseCrypto as any,
    );
    const tokenResponse = {
      session: { access_token: 'access', refresh_token: 'refresh' },
    };

    const result = await interceptor.intercept(
      makeContext(
        { email: 'user@example.com', password: 'secret' },
        { path: '/api/auth/login' },
      ),
      { handle: () => of(tokenResponse) },
    );

    await expect(lastValueFrom(result)).resolves.toEqual(tokenResponse);
    expect(responseCrypto.encrypt).toHaveBeenCalledWith(
      tokenResponse,
      expect.objectContaining({
        route: '/api/auth/login',
        keyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { id: 'idem-record-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        response: Prisma.DbNull,
        responseCiphertext: 'ciphertext',
        responseIv: 'iv',
        responseTag: 'tag',
        encryptionKeyId: 'v1',
      }),
    });
    expect(
      JSON.stringify(prisma.idempotencyRecord.update.mock.calls),
    ).not.toContain('access_token');
  });

  it('encrypts manual proof read credentials and delegates upload replay to durable proof intents', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
      responseCrypto as any,
    );
    const proof = { url: 'https://storage.example.invalid/signed-proof' };
    const response = await interceptor.intercept(
      makeContext(
        { kind: 'DEPOSIT' },
        { path: '/api/admin/exchange/manual-orders/order-1/proof-url' },
      ),
      { handle: () => of(proof) },
    );
    await expect(lastValueFrom(response)).resolves.toEqual(proof);
    expect(responseCrypto.encrypt).toHaveBeenCalledWith(
      proof,
      expect.anything(),
    );
    expect(redis.set).not.toHaveBeenCalled();
    prisma.idempotencyRecord.create.mockClear();
    const upload = await interceptor.intercept(
      makeContext(
        {},
        { path: '/api/exchange/manual-orders/order-1/upload-url' },
      ),
      { handle: () => of({ signedUrl: 'synthetic' }) },
    );
    await expect(lastValueFrom(upload)).resolves.toEqual({
      signedUrl: 'synthetic',
    });
    expect(prisma.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it('delegates handover evidence upload replay without persisting signed credentials', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const response = await interceptor.intercept(
      makeContext(
        {},
        {
          path: '/api/admin/exchange/manual-orders/order-1/handover-upload-url',
        },
      ),
      { handle: () => of({ signedUrl: 'temporary-upload-credential' }) },
    );
    await expect(lastValueFrom(response)).resolves.toEqual({
      signedUrl: 'temporary-upload-credential',
    });
    expect(prisma.idempotencyRecord.create).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('decrypts a persisted token-bearing auth replay without invoking the handler', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
      responseCrypto as any,
    );
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: responseCrypto.fingerprintRequest({
        email: 'user@example.com',
        password: 'secret',
      }),
      status: 'COMPLETED',
      response: null,
      responseCiphertext: 'ciphertext',
      responseIv: 'iv',
      responseTag: 'tag',
      encryptionKeyId: 'v1',
      updatedAt: new Date(),
    });
    const handler = jest.fn(() => of({ shouldNotRun: true }));

    const result = await interceptor.intercept(
      makeContext(
        { email: 'user@example.com', password: 'secret' },
        { path: '/api/auth/login' },
      ),
      { handle: handler },
    );

    await expect(lastValueFrom(result)).resolves.toEqual({
      session: { access_token: 'access', refresh_token: 'refresh' },
    });
    expect(responseCrypto.decrypt).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('replays the original failed response for a matching persisted key', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: hashBody({ amount: 200 }),
      status: 'FAILED_FINAL',
      response: null,
      httpStatus: 400,
      errorResponse: {
        statusCode: 400,
        message: 'Amount must be positive',
      },
    });

    await expect(
      interceptor.intercept(makeContext({ amount: 200 }), {
        handle: () => of({ reference: 'FUND-1' }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        statusCode: 400,
        message: 'Amount must be positive',
      },
    });
  });

  it('skips idempotency checks for webhook mutation requests', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const response = await interceptor.intercept(
      {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            originalUrl: '/api/webhooks/monnify',
            headers: {},
            user: { userId: 'user-1' },
            body: { amount: 200 },
          }),
        }),
      } as any,
      { handle: () => of({ received: true }) },
    );
    await expect(lastValueFrom(response)).resolves.toEqual({ received: true });
  });

  it('skips idempotency checks for bank account resolve lookups', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const response = await interceptor.intercept(
      {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            originalUrl: '/api/payments/banks/resolve',
            headers: {},
            user: { userId: 'user-1' },
            body: { accountNumber: '3081245010', bankCode: '011' },
          }),
        }),
      } as any,
      { handle: () => of({ accountName: 'NWOSU PAUL CHIBUIKE' }) },
    );

    await expect(lastValueFrom(response)).resolves.toEqual({
      accountName: 'NWOSU PAUL CHIBUIKE',
    });
    expect(prisma.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it('delegates internal-transfer idempotency to its atomic business record', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const response = await interceptor.intercept(
      makeContext(
        { recipientEmail: 'recipient@example.com', amount: '10.00' },
        { path: '/api/transfers/internal', headers: {} },
      ),
      { handle: () => of({ reference: 'IT-atomic' }) },
    );

    await expect(lastValueFrom(response)).resolves.toEqual({
      reference: 'IT-atomic',
    });
    expect(prisma.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it('completes the record even when the handler returns undefined', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );

    const response = await interceptor.intercept(makeContext({ amount: 200 }), {
      handle: () => of(undefined),
    });

    await expect(lastValueFrom(response)).resolves.toBeUndefined();
    // Must move out of IN_PROGRESS so retries don't get a spurious conflict.
    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { id: 'idem-record-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        response: Prisma.JsonNull,
      }),
    });
  });

  it.each(['/api/vtu/purchase', '/api/payments/withdraw'])(
    'requires a fresh attempt after a definite PIN rejection on %s',
    async (path) => {
      const records = new Map<string, any>();
      prisma.idempotencyRecord.findUnique.mockImplementation(
        async ({ where }) => records.get(where.scope_key.key) ?? null,
      );
      prisma.idempotencyRecord.create.mockImplementation(async ({ data }) => {
        const record = { ...data, id: data.key };
        records.set(data.key, record);
        return record;
      });
      prisma.idempotencyRecord.update.mockImplementation(
        async ({ where, data }) => {
          const updated = { ...records.get(where.id), ...data };
          records.set(where.id, updated);
          return updated;
        },
      );
      const interceptor = new IdempotencyInterceptor(
        redis as any,
        prisma as any,
        logger as any,
      );
      let mutations = 0;
      const request = (pin: string, key: string) =>
        makeContext(
          { amount: '500.00', transactionPin: pin },
          { path, headers: { 'idempotency-key': key } },
        );
      const rejected = {
        handle: jest.fn(() =>
          throwError(() => new ForbiddenException('Invalid transaction PIN')),
        ),
      };
      await expect(
        interceptor.intercept(request('1357', 'rejected-attempt'), rejected),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const accepted = {
        handle: jest.fn(() => {
          mutations++;
          return of({ reference: 'PAY-PIN-RETRY' });
        }),
      };
      await expect(
        interceptor.intercept(request('2468', 'rejected-attempt'), accepted),
      ).rejects.toThrow('Invalid transaction PIN');
      expect(accepted.handle).not.toHaveBeenCalled();
      const result = await interceptor.intercept(
        request('2468', 'corrected-attempt'),
        accepted,
      );
      expect(await lastValueFrom(result)).toEqual({
        reference: 'PAY-PIN-RETRY',
      });
      const replay = await interceptor.intercept(
        request('2468', 'corrected-attempt'),
        accepted,
      );
      expect(await lastValueFrom(replay)).toEqual({
        reference: 'PAY-PIN-RETRY',
      });
      expect(mutations).toBe(1);
    },
  );

  it('persists structured failed responses for handler errors', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );

    await expect(
      interceptor.intercept(makeContext({ amount: 0 }), {
        handle: () => throwError(() => new BadRequestException('Bad amount')),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { id: 'idem-record-1' },
      data: expect.objectContaining({
        status: 'FAILED_FINAL',
        httpStatus: 400,
        errorResponse: expect.objectContaining({
          message: 'Bad amount',
        }),
      }),
    });
  });

  it('returns the committed result and replays it when the cache write fails', async () => {
    redis.isAvailable.mockReturnValue(true);
    redis.setIfNotExists.mockResolvedValue(true);
    redis.set.mockRejectedValue(new Error('cache offline after commit'));
    redis.del.mockResolvedValue(undefined);
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const handler = jest.fn(() => of({ reference: 'only-withdrawal' }));
    const first = await interceptor.intercept(makeContext({ amount: 200 }), {
      handle: handler,
    });
    await expect(lastValueFrom(first)).resolves.toEqual({
      reference: 'only-withdrawal',
    });
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: hashBody({ amount: 200 }),
      status: 'COMPLETED',
      response: { reference: 'only-withdrawal' },
    });
    const second = await interceptor.intercept(makeContext({ amount: 200 }), {
      handle: handler,
    });
    await expect(lastValueFrom(second)).resolves.toEqual({
      reference: 'only-withdrawal',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(prisma.idempotencyRecord.delete).not.toHaveBeenCalled();
  });

  it('retains the in-progress reservation when completion persistence fails', async () => {
    prisma.idempotencyRecord.update.mockRejectedValueOnce(
      new Error('lost completion write'),
    );
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    await expect(
      interceptor.intercept(makeContext({ amount: 200 }), {
        handle: () => of({ reference: 'committed' }),
      }),
    ).rejects.toThrow('lost completion write');
    expect(prisma.idempotencyRecord.delete).not.toHaveBeenCalled();
  });

  it('does not let a lock cleanup failure erase a successful result', async () => {
    redis.isAvailable.mockReturnValue(true);
    redis.setIfNotExists.mockResolvedValue(true);
    redis.set.mockResolvedValue(undefined);
    redis.del.mockRejectedValueOnce(new Error('cleanup offline'));
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const stream = await interceptor.intercept(makeContext({ amount: 200 }), {
      handle: () => of({ reference: 'committed' }),
    });
    await expect(lastValueFrom(stream)).resolves.toEqual({
      reference: 'committed',
    });
  });

  it('does not memoize transient (non-HTTP) handler errors so retries can succeed', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );

    await expect(
      interceptor.intercept(makeContext({ amount: 200 }), {
        handle: () => throwError(() => new Error('connection reset')),
      }),
    ).rejects.toThrow('connection reset');

    // The in-progress record is removed, not persisted as a replayable failure.
    expect(prisma.idempotencyRecord.delete).toHaveBeenCalledWith({
      where: { id: 'idem-record-1' },
    });
    expect(prisma.idempotencyRecord.update).not.toHaveBeenCalled();
  });

  it('still blocks a retry while an in-progress lease is fresh', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'idem-record-1',
      requestHash: hashBody({ amount: 200 }),
      status: 'IN_PROGRESS',
      response: null,
      updatedAt: new Date(),
    });

    await expect(
      interceptor.intercept(makeContext({ amount: 200 }), {
        handle: () => of({ reference: 'FUND-1' }),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.idempotencyRecord.updateMany).not.toHaveBeenCalled();
  });

  it('lets a retry take over a stranded in-progress record once the lease lapses', async () => {
    const interceptor = new IdempotencyInterceptor(
      redis as any,
      prisma as any,
      logger as any,
    );
    const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000);
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'idem-record-1',
      requestHash: hashBody({ amount: 200 }),
      status: 'IN_PROGRESS',
      response: null,
      updatedAt: staleUpdatedAt,
    });

    const response = await interceptor.intercept(makeContext({ amount: 200 }), {
      handle: () => of({ reference: 'FUND-1' }),
    });

    await expect(lastValueFrom(response)).resolves.toEqual({
      reference: 'FUND-1',
    });
    expect(prisma.idempotencyRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'idem-record-1',
        status: 'IN_PROGRESS',
        updatedAt: staleUpdatedAt,
      },
      data: expect.objectContaining({ requestHash: hashBody({ amount: 200 }) }),
    });
    // Reuses the reclaimed record rather than creating a new one.
    expect(prisma.idempotencyRecord.create).not.toHaveBeenCalled();
    expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { id: 'idem-record-1' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });
});
