import { ForbiddenException } from '@nestjs/common';
import { TransactionPinService } from './transaction-pin.service';

type StoredValue = { value: string; expiresAt?: number };

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
      getClient: jest.fn(),
    },
  };
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
    const service = new TransactionPinService(
      redis as never,
      configService as never,
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
  });

  it('promotes the lock window to the daily ceiling under concurrent failures', async () => {
    const { store, redis } = createRedisMock();
    const service = new TransactionPinService(
      redis as never,
      configService as never,
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
});
