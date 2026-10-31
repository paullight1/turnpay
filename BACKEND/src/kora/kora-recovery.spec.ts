import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'crypto';
import { KoraCollectionsService } from './kora-collections.service';
import { KoraAccountsService } from './kora-accounts.service';
import { GhsWithdrawalsService } from './ghs-withdrawals.service';
import { ProviderExchangeSettlementService } from '../exchange/provider-exchange-settlement.service';

describe('Kora recovery regressions', () => {
  function collection() {
    const intent = {
      id: 'intent',
      userId: 'owner',
      reference: 'our-reference',
      providerReference: 'KPY-reference',
      status: 'PENDING',
      amount: new Decimal('10'),
      authorization: { model: 'OTP' },
      claimedAt: null as Date | null,
    };
    const db = {
      koraCollectionIntent: {
        findFirst: jest.fn().mockImplementation(async () => ({ ...intent })),
        findUnique: jest.fn().mockImplementation(async () => ({ ...intent })),
        updateMany: jest.fn().mockImplementation(async ({ data }) => {
          Object.assign(intent, data);
          return { count: 1 };
        }),
        update: jest
          .fn()
          .mockImplementation(async ({ data }) => Object.assign(intent, data)),
      },
    };
    const payment = {
      reference: 'KPY-reference',
      transaction_reference: 'KPY-reference',
      payment_reference: 'our-reference',
      amount: '10.00',
      currency: 'GHS',
      status: 'pending',
      auth_model: 'OTP',
    };
    const client = {
      request: jest.fn().mockImplementation(async (method: string) => {
        if (method === 'POST') throw new Error('uncertain response');
        return payment;
      }),
    };
    const service = new KoraCollectionsService(
      db as never,
      client as never,
      {} as never,
      {} as never,
      new ConfigService(),
    );
    return { intent, db, client, service, payment };
  }
  it('recovers a verified next action after an OTP response is lost, without a second charge', async () => {
    const { service, client, intent, payment } = collection();
    await expect(
      service.authorizeIntent('owner', 'intent', '123456'),
    ).rejects.toThrow();
    expect(
      (await service.refreshIntent('owner', 'intent')).authorization.model,
    ).toBe('OTP');
    client.request.mockImplementation(async () => ({
      ...payment,
      auth_model: 'STK_PROMPT',
    }));
    expect(
      (await service.authorizeIntent('owner', 'intent', '654321')).authorization
        .model,
    ).toBe('STK_PROMPT');
    expect(intent.claimedAt).toBeNull();
    expect(
      client.request.mock.calls.filter(
        ([, path]) => path === '/charges/mobile-money',
      ),
    ).toHaveLength(0);
  });
  it('does not restore authorization from a mismatched provider query', async () => {
    const { service, client, intent, payment } = collection();
    intent.authorization = { model: 'PENDING' };
    intent.claimedAt = new Date();
    client.request.mockResolvedValue({ ...payment, amount: '11.00' });
    expect(
      (await service.refreshIntent('owner', 'intent')).authorization.model,
    ).toBe('PENDING');
  });
  it('returns a fingerprint-matched existing charge after its order is funded and expired', async () => {
    const key = 'same-payment-key-123456',
      userId = 'owner',
      orderId = 'order',
      amount = new Decimal('10');
    const reference = `ghs-pay-${createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 32)}`;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          userId,
          orderId,
          amount: '10.00',
          phone: '233241234567',
        }),
      )
      .digest('hex');
    const intent = {
      id: 'intent',
      userId,
      reference,
      requestHash,
      amount,
      status: 'SUCCESS',
      submittedAt: new Date(),
      authorization: { model: 'PENDING' },
    };
    const db = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          isSuspended: false,
          kycStatus: 'VERIFIED',
          kycTier: 'TIER_2',
        }),
      },
      providerExchangeOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: orderId,
          userId,
          status: 'READY',
          quote: {
            sourceCurrency: 'GHS',
            fundingSource: 'EXTERNAL',
            total: amount,
            expiresAt: new Date(0),
          },
        }),
      },
      koraCollectionIntent: {
        findUnique: jest.fn().mockResolvedValue(intent),
        findFirst: jest.fn().mockResolvedValue(intent),
      },
    };
    const client = { request: jest.fn() };
    const service = new KoraCollectionsService(
      db as never,
      client as never,
      {} as never,
      { get: () => ({ momoCollections: true, exchange: true }) } as never,
      new ConfigService(),
    );
    expect(
      (
        await service.createMomoIntent(
          userId,
          orderId,
          { mobileNumber: '233241234567' },
          key,
        )
      ).status,
    ).toBe('SUCCESS');
    expect(client.request).not.toHaveBeenCalled();
    await expect(
      service.createMomoIntent(
        userId,
        orderId,
        { mobileNumber: '233241234568' },
        key,
      ),
    ).rejects.toThrow('different details');
  });
  for (const [Type, table, job, check] of [
    [
      KoraAccountsService,
      'koraAccountRequest',
      'recoverPendingAccounts',
      'refreshAccount',
    ],
    [
      KoraCollectionsService,
      'koraCollectionIntent',
      'recoverPendingPayments',
      'confirmCharge',
    ],
    [GhsWithdrawalsService, 'transferAttempt', 'recoverPending', 'reconcile'],
    [
      ProviderExchangeSettlementService,
      'providerExchangeOrder',
      'reconcilePending',
      'reconcile',
    ],
  ] as const)
    it(`${table} rotates unresolved batches rather than starving later records`, async () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({
        id: String(i),
        userId: String(i),
        reference: String(i),
        providerReference: String(i),
        payoutReference: String(i),
        updatedAt: new Date(i),
        lastCheckedAt: new Date(i),
        metadata: { flow: 'GHS_CASHOUT' },
      }));
      const findMany = jest
        .fn()
        .mockImplementation(async ({ take }) =>
          [...rows]
            .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
            .slice(0, take),
        );
      const updateMany = jest
        .fn()
        .mockImplementation(async ({ where, data }) => {
          Object.assign(rows.find((r) => r.id === where.id)!, data);
          return { count: 1 };
        });
      const update = jest
        .fn()
        .mockImplementation(async ({ where, data }) =>
          Object.assign(rows.find((r) => r.id === where.id)!, data),
        );
      const db = { [table]: { findMany, updateMany, update } };
      const service = Reflect.construct(Type, [db]) as Record<
        string,
        () => Promise<unknown>
      >;
      const checked = jest
        .fn()
        .mockRejectedValue(new Error('still unresolved'));
      service[check] = checked;
      await service[job]();
      await service[job]();
      await service[job]();
      expect(checked.mock.calls.some(([id]) => id === '24')).toBe(true);
      if (table === 'transferAttempt')
        expect(findMany.mock.calls[0][0].where.metadata).toEqual({
          path: ['flow'],
          equals: 'GHS_CASHOUT',
        });
    });
});
