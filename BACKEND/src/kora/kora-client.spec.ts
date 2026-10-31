import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { Decimal } from '@prisma/client/runtime/library';
import { createHmac } from 'crypto';
import {
  KoraClient,
  encodeKoraPayload,
  parseKoraMoney,
  verifyKoraSignature,
} from './kora.client';

describe('Kora trusted boundary', () => {
  it('verifies only the data-object signature and rejects malformed or changed data', () => {
    const data = { reference: 'synthetic', amount: '10.00', currency: 'GHS' };
    const signature = createHmac('sha256', 'synthetic-secret')
      .update(JSON.stringify(data))
      .digest('hex');
    expect(verifyKoraSignature(data, signature, 'synthetic-secret')).toBe(true);
    expect(
      verifyKoraSignature(
        { ...data, amount: '11.00' },
        signature,
        'synthetic-secret',
      ),
    ).toBe(false);
    expect(verifyKoraSignature(data, '0', 'synthetic-secret')).toBe(false);
    expect(verifyKoraSignature(data, signature, '')).toBe(false);
  });
  it('keeps major currency units exact and rejects invalid precision or unsafe values', () => {
    expect(parseKoraMoney('100.01').toFixed(2)).toBe('100.01');
    expect(
      encodeKoraPayload({
        destination: { amount: new Decimal('100.01'), currency: 'GHS' },
      }),
    ).toBe('{"destination":{"amount":100.01,"currency":"GHS"}}');
    for (const value of ['0', '-1', '1.001', '1e2', 'NaN', 1000000000000000000])
      expect(() => parseKoraMoney(value)).toThrow();
  });
  it('uses the fixed origin with no redirects and never retries an uncertain POST', async () => {
    const http = {
      request: jest
        .fn()
        .mockReturnValue(
          of({ data: { status: true, data: { reference: 'test' } } }),
        ),
    };
    const circuit = {
      canExecute: jest.fn().mockResolvedValue(true),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const client = new KoraClient(
      http as never,
      new ConfigService({ KORA_SECRET_KEY: 'sk_test_synthetic' }),
      circuit as never,
    );
    await client.request('POST', '/charges/mobile-money', {
      amount: new Decimal('1.25'),
    });
    expect(http.request.mock.calls[0][0]).toMatchObject({
      url: 'https://api.korapay.com/merchant/api/v1/charges/mobile-money',
      maxRedirects: 0,
      timeout: 15000,
    });
    await expect(client.request('GET', '//evil.example')).rejects.toThrow();
    http.request.mockReturnValue(
      throwError(() => new Error('upstream secret response')),
    );
    await expect(
      client.request('POST', '/charges/mobile-money', {}),
    ).rejects.toThrow('Check this payment');
    expect(http.request).toHaveBeenCalledTimes(2);
  });
});
