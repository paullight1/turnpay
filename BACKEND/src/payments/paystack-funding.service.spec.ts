import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { PaystackFundingService } from './paystack-funding.service';

describe('verified Paystack funding', () => {
  const transaction = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const prisma = {
    transaction,
    exchangeReceipt: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    exchangeDepositAllocation: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const client = {
    request: jest.fn(),
    ensureCustomer: jest.fn(),
    configured: true,
  };
  const ledger = { creditWallet: jest.fn() };
  const record = {
    id: 'tx',
    userId: 'owner',
    type: 'FUND',
    reference: 'fund_reference',
    currency: 'NGN',
    amount: new Decimal('100.01'),
    status: 'PENDING',
    metadata: {
      provider: 'PAYSTACK',
      channel: 'checkout',
      customerCode: 'CUS_fixture',
    },
  };
  const verified = {
    reference: 'fund_reference',
    status: 'success',
    amount: 10001,
    currency: 'NGN',
    domain: 'test',
    customer: { customer_code: 'CUS_fixture' },
  };
  let service: PaystackFundingService;
  it.each([false, true])(
    'allows recipient preparation while execution requires automatic approval (%s)',
    (enabled) => {
      const capabilities = new PaystackFundingService(
        prisma as never,
        ledger as never,
        { configured: true } as never,
        new ConfigService({
          BANKING_PROVIDER_PRIMARY: 'paystack',
          WITHDRAWALS_ENABLED: true,
          PAYSTACK_TRANSFER_APPROVAL_ENABLED: enabled,
        }),
        {} as never,
      ).capabilities();
      expect(capabilities).toMatchObject({
        bankTransferPreparation: true,
        withdrawals: enabled,
      });
    },
  );
  it.each([true, false])(
    'reports the actual internal transfer switch (%s), independently of Paystack',
    (enabled) => {
      const capabilities = new PaystackFundingService(
        prisma as never,
        ledger as never,
        { configured: false } as never,
        new ConfigService({ INTERNAL_TRANSFERS_ENABLED: enabled }),
        {} as never,
      ).capabilities();
      expect(capabilities).toMatchObject({
        internalTransfers: enabled,
        configured: false,
      });
    },
  );

  it('does not advertise Paystack withdrawals when the backend still selects the legacy provider', () => {
    const capabilities = new PaystackFundingService(
      prisma as never,
      ledger as never,
      { configured: true } as never,
      new ConfigService({ BANKING_PROVIDER_PRIMARY: 'monnify' }),
      {} as never,
    ).capabilities();
    expect(capabilities.withdrawals).toBe(false);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
      isSuspended: false,
    });
    transaction.findUnique.mockResolvedValue(record);
    transaction.updateMany.mockResolvedValue({ count: 1 });
    ledger.creditWallet.mockResolvedValue({
      walletId: 'wallet',
      balanceBefore: new Decimal(0),
      balanceAfter: new Decimal('100.01'),
    });
    client.request.mockResolvedValue(verified);
    client.ensureCustomer.mockResolvedValue({
      customerCode: 'CUS_fixture',
      customerId: '1',
    });
    transaction.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data, id: 'tx' }),
    );
    service = new PaystackFundingService(
      prisma as never,
      ledger as never,
      client as never,
      new ConfigService({
        NODE_ENV: 'test',
        PAYSTACK_SECRET_KEY: 'sk_test_fixture',
      }),
      {} as never,
    );
  });
  it('rejects a different owner before querying the provider', async () => {
    await expect(
      service.verify('other-user', 'fund_reference'),
    ).rejects.toThrow('not found');
    expect(client.request).not.toHaveBeenCalled();
  });
  it('does not credit a successful payment with the wrong amount', async () => {
    client.request.mockResolvedValue({ ...verified, amount: 10000 });
    await expect(service.verify('owner', 'fund_reference')).rejects.toThrow(
      'does not match',
    );
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });
  it('credits exact decimal units once through the guarded transaction', async () => {
    await service.verify('owner', 'fund_reference');
    expect(ledger.creditWallet.mock.calls[0][0].amount.toFixed(2)).toBe(
      '100.01',
    );
    transaction.updateMany.mockResolvedValue({ count: 0 });
    await service.verify('owner', 'fund_reference');
    expect(ledger.creditWallet).toHaveBeenCalledTimes(1);
  });
  it('never treats a pending provider response as value received', async () => {
    client.request.mockResolvedValue({ ...verified, status: 'pending' });
    await expect(
      service.verify('owner', 'fund_reference'),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });
  it('initializes with a provider-valid reference and a stable retry identity', async () => {
    transaction.findUnique.mockResolvedValue(null);
    client.request.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/fixture',
    });
    const result = await service.initialize('owner', '100.01', 'attempt-key');
    expect(result.reference).toMatch(/^[A-Za-z0-9.=-]+$/);
    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/transaction/initialize',
      expect.objectContaining({ reference: result.reference, amount: 10001 }),
    );
    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/transaction/initialize',
      expect.objectContaining({ channels: ['bank_transfer'] }),
    );
  });
  it('returns an actionable support reference for an existing pending checkout without a URL', async () => {
    transaction.findUnique.mockResolvedValue({
      ...record,
      metadata: { ...record.metadata },
    });

    const result = await service.initialize(
      'owner',
      '100.01',
      'pending-no-url-attempt',
    );

    expect(result.authorizationUrl).toBeUndefined();
    expect(result.message).toContain(result.reference);
    expect(result.message).toContain('contact support');
    expect(client.ensureCustomer).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
  });
  it('returns an actionable support reference when initialization confirmation is unavailable', async () => {
    transaction.findUnique.mockResolvedValue(null);
    client.request.mockRejectedValue(new Error('provider timeout'));

    const result = await service.initialize(
      'owner',
      '100.01',
      'unknown-init-attempt',
    );

    expect(result.status).toBe('PENDING');
    expect(result.message).toContain(result.reference);
    expect(result.message).toContain('contact support');
  });
  it('rejects a checkout URL containing embedded credentials', async () => {
    transaction.findUnique.mockResolvedValue(null);
    client.request.mockResolvedValue({
      authorization_url:
        'https://checkout-user:checkout-password@checkout.paystack.com/fixture',
    });

    await expect(
      service.initialize('owner', '100.01', 'credential-url-attempt'),
    ).rejects.toThrow('could not be confirmed');
  });
  it('rejects a checkout URL using a non-default port', async () => {
    transaction.findUnique.mockResolvedValue(null);
    client.request.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com:8443/fixture',
    });

    await expect(
      service.initialize('owner', '100.01', 'port-url-attempt'),
    ).rejects.toThrow('could not be confirmed');
  });
  it('rejects checkout amounts below NGN50 before persisting a payment', async () => {
    await expect(
      service.initialize('owner', '49.99', 'attempt-key'),
    ).rejects.toThrow('50');
    expect(transaction.create).not.toHaveBeenCalled();
  });
  it('marks an independently verified failed checkout as failed without credit', async () => {
    client.request.mockResolvedValue({ ...verified, status: 'failed' });
    await expect(
      service.confirmCharge('fund_reference'),
    ).resolves.toMatchObject({ status: 'FAILED' });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });
  it('credits a later independently confirmed success after an earlier failed checkout exactly once', async () => {
    transaction.findUnique.mockResolvedValue({ ...record, status: 'FAILED' });
    transaction.updateMany.mockImplementation(({ where }) =>
      Promise.resolve({
        count:
          Array.isArray(where.status?.in) && where.status.in.includes('FAILED')
            ? 1
            : 0,
      }),
    );
    await service.confirmCharge('fund_reference');
    expect(ledger.creditWallet).toHaveBeenCalledTimes(1);
  });
});
