import { retireLegacyIdempotencyCache } from './retire-legacy-idempotency-cache';

describe('legacy secret-bearing idempotency cache retirement', () => {
  it('defaults to inspection and keeps every key', async () => {
    const redis = {
      scan: jest
        .fn()
        .mockResolvedValue([
          '0',
          [
            'idempotency:user:POST:/api/payments/withdraw:old',
            'idempotency:v2:user:POST:/api/payments/withdraw:new',
            'wallet:unrelated',
          ],
        ]),
      unlink: jest.fn(),
    };
    expect(await retireLegacyIdempotencyCache(redis as never)).toEqual({
      scanned: 3,
      legacyMatches: 1,
      removed: 0,
      applied: false,
    });
    expect(redis.unlink).not.toHaveBeenCalled();
  });
  it('retires only old idempotency keys across cursor batches, preserving current replay and other application data', async () => {
    const live = new Set([
      'idempotency:old-a',
      'idempotency:old-b',
      'idempotency:v2:current',
      'wallet:keep',
    ]);
    const redis = {
      scan: jest
        .fn()
        .mockResolvedValueOnce(['next', [...live]])
        .mockResolvedValueOnce(['0', ['idempotency:old-b']]),
      unlink: async (...keys: string[]) =>
        keys.reduce((removed, key) => removed + Number(live.delete(key)), 0),
    };
    expect(
      await retireLegacyIdempotencyCache(redis as never, true),
    ).toMatchObject({ removed: 2, applied: true });
    expect([...live]).toEqual(['idempotency:v2:current', 'wallet:keep']);
  });
});
