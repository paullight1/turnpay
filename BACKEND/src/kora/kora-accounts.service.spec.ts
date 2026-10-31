import { KoraAccountsService } from './kora-accounts.service';

describe('Kora account lifecycle', () => {
  const user = {
    id: 'owner',
    fullName: 'Synthetic Owner',
    email: 'owner@example.invalid',
    kycStatus: 'VERIFIED',
    kycTier: 'TIER_2',
    isSuspended: false,
  };
  function fixture(status = 'PENDING') {
    const request = {
      id: 'req',
      userId: 'owner',
      reference: 'ghs-account-owner',
      status,
      submittedAt: new Date(),
    };
    const db = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      koraAccountRequest: {
        upsert: jest.fn().mockResolvedValue(request),
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      virtualAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest
          .fn()
          .mockImplementation(({ create }) => ({ id: 'account', ...create })),
      },
      auditLog: { create: jest.fn() },
    };
    const client = {
      request: jest.fn().mockResolvedValue({
        account_reference: request.reference,
        account_status: 'pending',
        currency: 'GHS',
      }),
    };
    const service = new KoraAccountsService(
      db as never,
      client as never,
      { get: () => ({ virtualAccounts: true }) } as never,
    );
    return { service, db, client, request };
  }
  it('keeps pending details empty and only queries after uncertain dispatch', async () => {
    const { service, client } = fixture();
    expect(
      await service.ensureAccount('owner', 'synthetic-idempotency-key'),
    ).toMatchObject({ status: 'PENDING', accountNumber: '', currency: 'GHS' });
    expect(
      client.request.mock.calls.every(([method]) => method === 'GET'),
    ).toBe(true);
  });
  it('checks owned account reference and currency before exposing active details', async () => {
    const { service, client, db, request } = fixture();
    client.request.mockResolvedValue({
      account_reference: request.reference,
      account_status: 'active',
      currency: 'NGN',
      account_number: '1234567890',
      account_name: 'Synthetic',
      bank_name: 'Test bank',
    });
    await expect(service.refreshAccount('owner')).rejects.toThrow(
      'could not be verified',
    );
    expect(db.virtualAccount.upsert).not.toHaveBeenCalled();
  });
  it('does not allow suspended customers to provision an account', async () => {
    const { service, db } = fixture();
    db.user.findUnique.mockResolvedValue({ ...user, isSuspended: true });
    await expect(
      service.ensureAccount('owner', 'synthetic-idempotency-key'),
    ).rejects.toThrow('unavailable');
  });
});
