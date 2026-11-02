import { createHash } from 'node:crypto';
import { IdempotencyResponseCryptoService } from './idempotency-response-crypto.service';

describe('IdempotencyResponseCryptoService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const config = {
    get: jest.fn((name: string) => {
      if (name === 'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY') return key;
      if (name === 'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID') return 'v1';
      if (name === 'NODE_ENV') return 'test';
      return undefined;
    }),
  };
  const aad = {
    route: '/api/auth/login',
    scope: 'anonymous:POST:/api/auth/login',
    keyDigest: 'a'.repeat(64),
  };

  it('encrypts and decrypts a token-bearing response without plaintext fields', () => {
    const service = new IdempotencyResponseCryptoService(config as never);
    const encrypted = service.encrypt(
      { session: { access_token: 'access', refresh_token: 'refresh' } },
      aad,
    );

    expect(JSON.stringify(encrypted)).not.toContain('access');
    expect(encrypted.encryptionKeyId).toBe('v1');
    expect(service.decrypt(encrypted, aad)).toEqual({
      session: { access_token: 'access', refresh_token: 'refresh' },
    });
  });

  it('rejects ciphertext replayed under a different route or key digest', () => {
    const service = new IdempotencyResponseCryptoService(config as never);
    const encrypted = service.encrypt({ session: { access_token: 'a' } }, aad);

    expect(() =>
      service.decrypt(encrypted, { ...aad, route: '/api/auth/refresh' }),
    ).toThrow();
  });

  it('rejects a tampered authentication tag', () => {
    const service = new IdempotencyResponseCryptoService(config as never);
    const encrypted = service.encrypt({ session: { access_token: 'a' } }, aad);

    expect(() =>
      service.decrypt(
        {
          ...encrypted,
          responseTag: Buffer.alloc(16, 9).toString('base64url'),
        },
        aad,
      ),
    ).toThrow();
  });

  it('binds auth fingerprints to the server key, route and full secret without storing an offline PIN oracle', () => {
    const service = new IdempotencyResponseCryptoService(config as never);
    const body = { pin: '2468', amount: '100.00' };
    const first = (service as any).fingerprintRequest(body, aad);
    expect(first).toBe((service as any).fingerprintRequest(body, aad));
    expect(first).not.toBe(
      (service as any).fingerprintRequest({ ...body, pin: '2469' }, aad),
    );
    expect(first).not.toBe(
      (service as any).fingerprintRequest(body, { ...aad, scope: 'other' }),
    );
    const other = new IdempotencyResponseCryptoService({
      get: (name: string) =>
        name === 'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY'
          ? Buffer.alloc(32, 8).toString('base64')
          : 'v1',
    } as never);
    expect(first).not.toBe((other as any).fingerprintRequest(body, aad));
    expect(first).not.toContain(
      createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    );
  });

  it('fails startup validation for a configured key that is not 32 bytes', () => {
    const invalidConfig = {
      get: jest.fn((name: string) => {
        if (name === 'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY') {
          return Buffer.alloc(16).toString('base64');
        }
        if (name === 'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID') return 'v1';
        return 'test';
      }),
    };

    expect(
      () => new IdempotencyResponseCryptoService(invalidConfig as never),
    ).toThrow('must decode to exactly 32 bytes');
  });
});
