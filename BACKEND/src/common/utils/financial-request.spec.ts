import { financialRequestIdentity } from './financial-request';

describe('durable financial request identity', () => {
  it('binds one stable short reference to user, operation and client key, independently of the PIN', () => {
    const first = financialRequestIdentity('WITHDRAW', 'user', 'retry-1', {
      amount: '100.00',
      transactionPin: '1234',
    });
    const retry = financialRequestIdentity('WITHDRAW', 'user', 'retry-1', {
      transactionPin: '5678',
      amount: '100.00',
    });
    expect(retry).toEqual(first);
    expect(first.reference.length).toBeLessThanOrEqual(50);
    expect(
      financialRequestIdentity('WITHDRAW', 'other', 'retry-1', {}).reference,
    ).not.toBe(first.reference);
    expect(
      financialRequestIdentity('VTU', 'user', 'retry-1', {}).reference,
    ).not.toBe(first.reference);
    expect(
      financialRequestIdentity('WITHDRAW', 'user', 'retry-2', {}).reference,
    ).not.toBe(first.reference);
    expect(
      financialRequestIdentity('WITHDRAW', 'user', 'retry-1', {
        amount: '200.00',
      }).fingerprint,
    ).not.toBe(first.fingerprint);
  });
  it.each(['', ' ', 'x'.repeat(201), undefined])(
    'rejects missing or malformed retry keys: %s',
    (key) => {
      expect(() =>
        financialRequestIdentity('VTU', 'user', key as string, {}),
      ).toThrow('Idempotency-Key');
    },
  );
});
