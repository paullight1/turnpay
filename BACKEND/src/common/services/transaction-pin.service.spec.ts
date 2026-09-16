import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TransactionPinService } from './transaction-pin.service';

type StoredValue = { value: string; expiresAt?: number };
type StoredCredential = {
  userId: string;
  salt: string;
  hash: string;
  iterations: number;
  pinLength: number;
  resetHoldUntil: Date | null;
};

function createRedisMock() {
  const store = new Map<string, StoredValue>();
  const read = (key: string) => {
    const item = store.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return item.value;
  };

  return {
    store,
    redis: {
      get: jest.fn(async (key: string) => read(key)),
      set: jest.fn(async (key: string, value: string, ttl?: number) => {
        store.set(key, {
          value,
          expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
        });
      }),
      del: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      setIfNotExists: jest.fn(
        async (key: string, value: string, ttlSeconds: number) => {
          if (read(key) !== null) return false;
          store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
          return true;
        },
      ),
      isRedisAvailable: jest.fn(() => false),
      isAvailable: jest.fn(() => false),
      isMemoryFallbackAllowed: jest.fn(() => true),
      assertAvailable: jest.fn(),
      reportOperationalAlert: jest.fn(),
      getClient: jest.fn(),
    },
  };
}

function createPrismaMock(credentials = new Map<string, StoredCredential>()) {
  const transactionPinCredential = {
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const existing = credentials.get(where.userId);
      const next = existing
        ? { ...existing, ...update }
        : { ...create, resetHoldUntil: create.resetHoldUntil ?? null };
      credentials.set(where.userId, next);
      return next;
    }),
    create: jest.fn(async ({ data }: any) => {
      if (credentials.has(data.userId)) {
        throw new Error('duplicate credential');
      }
      const created = { ...data, resetHoldUntil: null };
      credentials.set(data.userId, created);
      return created;
    }),
    findUnique: jest.fn(async ({ where, select }: any) => {
      const credential = credentials.get(where.userId);
      if (!credential) return null;
      return Object.fromEntries(
        Object.keys(select).map((key) => [
          key,
          credential[key as keyof StoredCredential],
        ]),
      );
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const existing = credentials.get(where.userId);
      if (!existing) throw new Error('missing credential');
      const updated = { ...existing, ...data };
      credentials.set(where.userId, updated);
      return updated;
    }),
  };

  const prisma = {
    transactionPinCredential,
    auditLog: { create: jest.fn(async () => ({ id: 'pin-audit' })) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (work: (tx: typeof prisma) => Promise<unknown>) => {
      const before = new Map(credentials);
      try {
        return await work(prisma);
      } catch (error) {
        credentials.clear();
        for (const [key, value] of before) credentials.set(key, value);
        throw error;
      }
    },
  );
  return { credentials, prisma };
}

describe('TransactionPinService', () => {
  const configService = {
    get: jest.fn((key: string, fallback?: boolean) => {
      if (key === 'TRANSACTION_PIN_REQUIRED') return true;
      if (key === 'NODE_ENV') return fallback ? 'production' : 'test';
      return fallback;
    }),
  };

  it('locks verification after concurrent invalid PIN attempts', async () => {
    const { redis } = createRedisMock();
    const { prisma } = createPrismaMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
      prisma as never,
    );
    await service.setPin('user-1', '1234');

    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () => service.verifyPin('user-1', '9999')),
    );

    expect(attempts).toHaveLength(6);
    expect(attempts.every((attempt) => attempt.status === 'rejected')).toBe(
      true,
    );
    expect(
      attempts.every(
        (attempt) =>
          attempt.status === 'rejected' &&
          attempt.reason instanceof ForbiddenException,
      ),
    ).toBe(true);
    await expect(service.verifyPin('user-1', '1234')).rejects.toThrow(
      'Transaction PIN is temporarily locked',
    );
    expect(redis.reportOperationalAlert).toHaveBeenCalledWith(
      'TRANSACTION_PIN_LOCK_TRIGGERED',
      { lockWindow: 'rolling' },
    );
  });

  it('promotes the lock window to the daily ceiling under concurrent failures', async () => {
    const { store, redis } = createRedisMock();
    const { prisma } = createPrismaMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
      prisma as never,
    );
    await service.setPin('user-1', '1234');

    await Promise.allSettled(
      Array.from({ length: 15 }, () => service.verifyPin('user-1', '9999')),
    );

    const lockEntry = store.get('transaction-pin-lock:user-1');
    expect(lockEntry?.expiresAt).toBeDefined();
    expect((lockEntry?.expiresAt ?? 0) - Date.now()).toBeGreaterThan(
      23 * 60 * 60 * 1000,
    );
  });

  it('keeps the PIN credential when Redis state is lost', async () => {
    const persistent = createPrismaMock();
    const firstRedis = createRedisMock();
    const firstInstance = new TransactionPinService(
      firstRedis.redis as never,
      configService as never,
      persistent.prisma as never,
    );
    await firstInstance.setPin('user-1', '1234');

    const replacementRedis = createRedisMock();
    const restartedInstance = new TransactionPinService(
      replacementRedis.redis as never,
      configService as never,
      persistent.prisma as never,
    );

    await expect(
      restartedInstance.verifyPin('user-1', '1234'),
    ).resolves.toBeUndefined();
    expect(persistent.credentials.get('user-1')?.hash).toBeTruthy();
  });

  it('verifies the PIN only once for a protected money movement', async () => {
    const { redis } = createRedisMock();
    const { prisma } = createPrismaMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
      prisma as never,
    );
    await service.setPin('user-1', '1234');
    prisma.transactionPinCredential.findUnique.mockClear();

    await service.verifyRequired('user-1', '1234');

    // One read checks resetHoldUntil; one read loads the credential for PBKDF2.
    expect(prisma.transactionPinCredential.findUnique).toHaveBeenCalledTimes(2);
  });

  it('returns unconfigured state when no server credential exists', async () => {
    const { redis } = createRedisMock();
    const { prisma } = createPrismaMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
      prisma as never,
    );

    await expect(service.getStatus('user-1')).resolves.toEqual({
      configured: false,
      pinLength: null,
      resetHoldUntil: null,
      locked: false,
    });
  });

  it('keeps the reset hold when Redis cleanup fails after saving the new PIN', async () => {
    const { redis } = createRedisMock();
    const { prisma, credentials } = createPrismaMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
      prisma as never,
    );
    await service.setPin('user-1', '1234');
    redis.del.mockRejectedValueOnce(new Error('Redis connection lost'));

    await expect(
      service.resetPinWithHold('user-1', '5678'),
    ).resolves.toMatchObject({ success: true });

    expect(
      credentials.get('user-1')?.resetHoldUntil?.getTime(),
    ).toBeGreaterThan(Date.now());
    await expect(service.verifyRequired('user-1', '5678')).rejects.toThrow(
      'money movement is temporarily locked',
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(redis.reportOperationalAlert).toHaveBeenCalledWith(
      'TRANSACTION_PIN_RESET_CLEANUP_FAILED',
    );
  });

  it('rolls back the reset when its audit record cannot be committed', async () => {
    const { redis } = createRedisMock();
    const { prisma, credentials } = createPrismaMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
      prisma as never,
    );
    await service.setPin('user-1', '1234');
    const before = credentials.get('user-1');
    prisma.auditLog.create.mockRejectedValueOnce(
      new Error('Audit write failed'),
    );
    await expect(service.resetPinWithHold('user-1', '5678')).rejects.toThrow(
      'Audit write failed',
    );
    expect(credentials.get('user-1')).toEqual(before);
    await expect(
      service.verifyRequired('user-1', '1234'),
    ).resolves.toBeUndefined();
  });

  it('does not authorize a PIN whose credential changes during verification', async () => {
    const { redis } = createRedisMock();
    const { prisma, credentials } = createPrismaMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
      prisma as never,
    );
    await service.setPin('user-1', '1234');
    const originalDel = redis.del.getMockImplementation()!;
    let changed = false;
    redis.del.mockImplementation(async (key: string) => {
      if (!changed && key === 'transaction-pin-failures:user-1') {
        changed = true;
        const current = credentials.get('user-1')!;
        credentials.set('user-1', {
          ...current,
          hash: 'new-credential',
          resetHoldUntil: new Date(Date.now() + 3600000),
        });
      }
      await originalDel(key);
    });

    await expect(service.verifyRequired('user-1', '1234')).rejects.toThrow();
  });

  it('returns configured, locked, and recent-reset state from server stores', async () => {
    const { redis } = createRedisMock();
    const { prisma } = createPrismaMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
      prisma as never,
    );
    await service.setPin('user-1', '123456');
    const holdUntil = await service.setResetHold('user-1', 3600);
    await redis.set('transaction-pin-lock:user-1', '1', 900);

    await expect(service.getStatus('user-1')).resolves.toEqual({
      configured: true,
      pinLength: 6,
      resetHoldUntil: holdUntil,
      locked: true,
    });
  });

  it.each(['setPin', 'setInitialPin', 'setResetHold'] as const)(
    'fails closed before persisting %s when distributed controls are unavailable',
    async (method) => {
      const { redis } = createRedisMock();
      const { credentials, prisma } = createPrismaMock();
      redis.assertAvailable.mockImplementation(() => {
        throw new ServiceUnavailableException('Redis unavailable');
      });
      const service = new TransactionPinService(
        redis as never,
        configService as never,
        prisma as never,
      );

      const operation =
        method === 'setResetHold'
          ? service.setResetHold('user-1')
          : service[method]('user-1', '1234');

      await expect(operation).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(credentials.size).toBe(0);
      expect(prisma.transactionPinCredential.create).not.toHaveBeenCalled();
      expect(prisma.transactionPinCredential.upsert).not.toHaveBeenCalled();
      expect(prisma.transactionPinCredential.update).not.toHaveBeenCalled();
    },
  );
});
