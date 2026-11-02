import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { TierOneLimitsService } from './tier-one-limits.service';

describe('TierOneLimitsService', () => {
  const policy = {
    TIER_ONE_NGN_PER_TRANSACTION: '100',
    TIER_ONE_NGN_DAILY: '200',
    TIER_ONE_NGN_MAX_BALANCE: '300',
  };
  const input = {
    userId: 'u',
    currency: 'NGN' as const,
    amount: new Decimal(50),
    source: 'VTU_PURCHASE',
  };
  function setup(values: Record<string, string> = policy) {
    const service = new TierOneLimitsService(new ConfigService(values));
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          kycTier: 'TIER_1',
          kycStatus: 'VERIFIED',
          isSuspended: false,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'w',
          balance: new Decimal(100),
          kycTier: 'TIER_1',
          kycStatus: 'VERIFIED',
          isSuspended: false,
        },
      ]),
      ledgerEntry: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amount: new Decimal(0) } }),
      },
      exchangeReceipt: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amount: new Decimal(0) } }),
      },
      manualExchangeOrder: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amount: new Decimal(0) } }),
      },
    };
    return { service, tx };
  }
  it('fails closed when a tier one policy is missing or malformed', async () => {
    for (const values of [
      {},
      { ...policy, TIER_ONE_NGN_DAILY: 'NaN' },
      { ...policy, TIER_ONE_NGN_DAILY: '1' },
    ]) {
      const { service, tx } = setup(values);
      await expect(
        service.checkMovement(tx as any, input, 'DEBIT'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'TIER_ONE_POLICY_UNAVAILABLE',
        }),
      });
    }
  });
  it('permits a configured tier one debit and rejects a per transaction excess', async () => {
    const { service, tx } = setup();
    await expect(
      service.checkMovement(tx as any, input, 'DEBIT'),
    ).resolves.toBeUndefined();
    await expect(
      service.checkMovement(
        tx as any,
        { ...input, amount: new Decimal(101) },
        'DEBIT',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'KYC_LIMIT_EXCEEDED' }),
    });
  });
  it('combines wallet spending and direct exchange reservations under the same lock', async () => {
    const { service, tx } = setup();
    tx.ledgerEntry.aggregate.mockResolvedValue({
      _sum: { amount: new Decimal(100) },
    });
    tx.manualExchangeOrder.aggregate.mockResolvedValue({
      _sum: { amount: new Decimal(60) },
    });
    await expect(
      service.checkMovement(tx as any, input, 'DEBIT'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'KYC_LIMIT_EXCEEDED' }),
    });
    expect(tx.$queryRaw.mock.calls[0][0].sql).toContain('FOR UPDATE OF w');
    expect(tx.ledgerEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          transaction: { status: { notIn: ['FAILED', 'REVERSED'] } },
        }),
      }),
    );
  });
  it('caps incoming balances while permitting compensating refunds without a policy', async () => {
    const { service, tx } = setup();
    await expect(
      service.checkMovement(
        tx as any,
        { ...input, amount: new Decimal(201) },
        'CREDIT',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'KYC_BALANCE_LIMIT_EXCEEDED' }),
    });
    const missing = setup({});
    await expect(
      missing.service.checkMovement(
        missing.tx as any,
        { ...input, source: 'VTU_REVERSAL' },
        'CREDIT',
      ),
    ).resolves.toBeUndefined();
    expect(missing.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('leaves existing tier two limits to their current policies', async () => {
    const { service, tx } = setup({});
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'w',
        balance: new Decimal(100),
        kycTier: 'TIER_2',
        kycStatus: 'VERIFIED',
        isSuspended: false,
      },
    ]);
    await expect(
      service.checkMovement(tx as any, input, 'DEBIT'),
    ).resolves.toBeUndefined();
    expect(tx.ledgerEntry.aggregate).not.toHaveBeenCalled();
  });
  it('uses the same daily budget for external exchange creation', async () => {
    const { service, tx } = setup();
    tx.ledgerEntry.aggregate.mockResolvedValue({
      _sum: { amount: new Decimal(160) },
    });
    await expect(
      service.checkExternalExchange(tx as any, input),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'KYC_LIMIT_EXCEEDED' }),
    });
  });
  it('preserves external Tier 2 exchange without requiring a source-currency wallet', async () => {
    const { service, tx } = setup({});
    tx.user.findUnique.mockResolvedValue({
      kycTier: 'TIER_2',
      kycStatus: 'VERIFIED',
      isSuspended: false,
    });
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      service.checkExternalExchange(tx as any, input),
    ).resolves.toBeUndefined();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    { kycTier: 'TIER_1', kycStatus: 'VERIFIED', isSuspended: true },
    { kycTier: 'TIER_0', kycStatus: 'PENDING', isSuspended: false },
  ])(
    'rechecks external exchange eligibility after acquiring the wallet lock: %j',
    async (current) => {
      const { service, tx } = setup();
      tx.$queryRaw.mockResolvedValue([
        { id: 'w', balance: new Decimal(100), ...current },
      ]);
      await expect(
        service.checkExternalExchange(tx as never, input),
      ).rejects.toMatchObject({ status: 403 });
    },
  );

  it('uses an earned upgrade observed under the lock instead of stale Tier 1 limits', async () => {
    const { service, tx } = setup({});
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'w',
        balance: new Decimal(100),
        kycTier: 'TIER_2',
        kycStatus: 'VERIFIED',
        isSuspended: false,
      },
    ]);
    await expect(
      service.checkExternalExchange(tx as never, input),
    ).resolves.toBeUndefined();
  });
});
