import { KoraCollectionsService } from '../src/kora/kora-collections.service';
import { GhsWithdrawalsService } from '../src/kora/ghs-withdrawals.service';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ProviderExchangeService } from '../src/exchange/provider-exchange.service';
import { ProviderExchangeSettlementService } from '../src/exchange/provider-exchange-settlement.service';
import { KoraPayoutsService } from '../src/kora/kora-payouts.service';
import { LedgerService } from '../src/wallets/ledger.service';
import { SettlementHoldService } from '../src/common/services/settlement-hold.service';
import {
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  cleanupFinancialTransferFixture,
  walletBalance,
} from './support/transfer-fixtures';

describe('Provider exchange financial integrity', () => {
  let db: PrismaClient;
  let fixture: Awaited<ReturnType<typeof createFinancialTransferFixture>>;
  let service: ProviderExchangeService;
  let settlement: ProviderExchangeSettlementService;
  let paystack: { configured: boolean; request: jest.Mock };
  let kora: { request: jest.Mock };
  let withdrawals: GhsWithdrawalsService;
  let rateLookup: { getRate: jest.Mock; assertQuoteSafe: jest.Mock };
  let verification: Record<string, unknown>;
  const config = new ConfigService({
    BANK_ACCOUNT_ENCRYPTION_KEY: 'synthetic-test-secret',
    PAYSTACK_EXCHANGE_USE_CASE_APPROVED: true,
    KORA_GHS_DAILY_LIMIT: '10000',
    KORA_GHS_MONTHLY_LIMIT: '100000',
  });
  beforeAll(async () => {
    db = createFinancialTestPrisma();
    await db.$connect();
  });
  beforeEach(async () => {
    fixture = await createFinancialTransferFixture(db, {
      createPolicies: false,
    });
    verification = {};
    paystack = {
      configured: true,
      request: jest
        .fn()
        .mockImplementation(async (method: string, path: string) => {
          if (path === '/bank/resolve')
            return {
              account_name: 'Verified Receiver',
              account_number: '0123456789',
            };
          if (path === '/transferrecipient')
            return { recipient_code: 'RCP_synthetic' };
          if (path === '/transfer') return { status: 'pending' };
          if (path.startsWith('/transfer/verify/')) return verification;
          if (path === '/balance')
            return [{ currency: 'NGN', balance: 1000000000 }];
          throw new Error('Unexpected test path');
        }),
    };
    kora = {
      request: jest
        .fn()
        .mockImplementation(async (_method: string, path: string) => {
          if (path === '/misc/mobile-money')
            return [{ slug: 'mtn-gh', code: '0004', name: 'MTN Ghana' }];
          if (path === '/misc/mobile-money/resolve')
            return { account_name: 'Verified Receiver' };
          if (path === '/balances')
            return { GHS: { available_balance: '100000.00' } };
          if (path.startsWith('/transactions/')) return verification;
          return {};
        }),
    };
    const capabilities = {
      get: () => ({ exchange: true, momoPayouts: true, momoCollections: true }),
    };
    const ledger = new LedgerService(db as never);
    const hold = new SettlementHoldService(db as never);
    rateLookup = {
      assertQuoteSafe: jest.fn().mockResolvedValue(undefined),
      getRate: jest
        .fn()
        .mockResolvedValue({ rate: 100, markup: 0, isStale: false }),
    };
    service = new ProviderExchangeService(
      db as never,
      ledger,
      rateLookup as never,
      { verifyRequired: jest.fn() } as never,
      config,
      capabilities as never,
      kora as never,
      paystack as never,
      hold,
    );
    withdrawals = new GhsWithdrawalsService(
      db as never,
      ledger,
      { verifyRequired: jest.fn() } as never,
      config,
      capabilities as never,
      new KoraPayoutsService(kora as never, config),
      hold,
    );
    settlement = new ProviderExchangeSettlementService(
      db as never,
      ledger,
      new KoraPayoutsService(kora as never, config),
      paystack as never,
      config,
      capabilities as never,
      hold,
    );
  });
  afterEach(async () => {
    const ids = Object.values(fixture.users).map((u) => u.id);
    const orders = await db.providerExchangeOrder.findMany({
      where: { userId: { in: ids } },
    });
    const orderIds = orders.map((o) => o.id);
    await db.exchangeDepositAllocation.deleteMany({
      where: { settlementId: { in: orderIds.map((id) => `kora-order:${id}`) } },
    });
    await db.providerEvent.deleteMany({
      where: {
        provider: 'KORA',
        providerReference: { in: orderIds.map((id) => `KPY-${id}`) },
      },
    });
    await db.koraCollectionIntent.deleteMany({
      where: { userId: { in: ids } },
    });
    await db.paymentNotification.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await db.exchangeTreasuryEntry.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await db.providerExchangeOrder.deleteMany({
      where: { id: { in: orderIds } },
    });
    await db.providerExchangeQuote.deleteMany({
      where: { userId: { in: ids } },
    });
    await db.currencyLimitUsage.deleteMany({ where: { userId: { in: ids } } });
    await db.transferAttempt.deleteMany({
      where: { transaction: { userId: { in: ids } } },
    });
    await cleanupFinancialTransferFixture(db, fixture);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const quote = () =>
    service.quote(fixture.users.sender.id, {
      sourceCurrency: 'GHS',
      fundingSource: 'WALLET',
      amount: '10.00',
      destinationCode: '058',
      destinationNumber: '0123456789',
    });
  it('checks frozen provider terms inside the reservation transaction', async () => {
    const q = await quote();
    rateLookup.assertQuoteSafe.mockRejectedValueOnce(
      new Error('Quote price changed'),
    );
    await expect(
      service.create(
        fixture.users.sender.id,
        q.id,
        '1234',
        'frozen-pair-attempt-12345',
      ),
    ).rejects.toThrow('Quote price changed');
    expect(
      await db.providerExchangeOrder.count({ where: { quoteId: q.id } }),
    ).toBe(0);
    expect(rateLookup.assertQuoteSafe).toHaveBeenCalled();
  });

  it('rejects an old upward-rounded provider target before reservation', async () => {
    const q = await quote();
    await db.providerExchangeQuote.update({
      where: { id: q.id },
      data: {
        amount: '0.51',
        rate: '0.01',
        targetAmount: '0.01',
        total: '0.51',
        fee: '0',
      },
    });
    await expect(
      service.create(
        fixture.users.sender.id,
        q.id,
        '1234',
        'rounded-target-attempt-12345',
      ),
    ).rejects.toThrow('new quote');
    expect(
      await db.providerExchangeOrder.count({ where: { quoteId: q.id } }),
    ).toBe(0);
  });

  it('blocks a previously issued provider quote when the live rate pair becomes unsafe', async () => {
    const q = await quote();
    const before = await db.transaction.count({
      where: { userId: fixture.users.sender.id },
    });
    rateLookup.getRate.mockRejectedValue(
      new Error('Exchange pricing is being updated'),
    );
    await expect(
      service.create(
        fixture.users.sender.id,
        q.id,
        '1234',
        'unsafe-pair-attempt-12345',
      ),
    ).rejects.toThrow('pricing');
    expect(
      await db.providerExchangeOrder.count({ where: { quoteId: q.id } }),
    ).toBe(0);
    expect(
      await db.transaction.count({
        where: { userId: fixture.users.sender.id },
      }),
    ).toBe(before);
  });

  it('freezes terms and debits once across concurrent same-key attempts', async () => {
    const q = await quote();
    const results = await Promise.allSettled([
      service.create(
        fixture.users.sender.id,
        q.id,
        '1234',
        'synthetic-exchange-key',
      ),
      service.create(
        fixture.users.sender.id,
        q.id,
        '1234',
        'synthetic-exchange-key',
      ),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const order = await service.create(
      fixture.users.sender.id,
      q.id,
      '1234',
      'synthetic-exchange-key',
    );
    expect(order.quote.targetAmount).toBe('1000.00');
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('989.90');
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'NGN')).toFixed(2),
    ).toBe('1000.00');
    expect(
      await db.paymentNotification.count({ where: { orderId: order.id } }),
    ).toBe(1);
    expect(
      (
        await db.transaction.findUniqueOrThrow({
          where: { id: order.transactionId },
        })
      ).status,
    ).toBe('PENDING');
    await expect(
      service.create(
        fixture.users.sender.id,
        q.id,
        '1234',
        'different-exchange-key',
      ),
    ).rejects.toThrow();
  });
  it('rolls back the order and obligation when the source balance is insufficient', async () => {
    const q = await service.quote(fixture.users.sender.id, {
      sourceCurrency: 'GHS',
      fundingSource: 'WALLET',
      amount: '1001.00',
      destinationCode: '058',
      destinationNumber: '0123456789',
    });
    await expect(
      service.create(
        fixture.users.sender.id,
        q.id,
        '1234',
        'synthetic-exchange-key',
      ),
    ).rejects.toThrow('Insufficient');
    expect(
      await db.providerExchangeOrder.count({
        where: { userId: fixture.users.sender.id },
      }),
    ).toBe(0);
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('1000.00');
  });
  it('reserves one outgoing attempt across two admins and stays pending after dispatch', async () => {
    const order = await service.create(
      fixture.users.sender.id,
      (await quote()).id,
      '1234',
      'synthetic-exchange-key',
    );
    await Promise.allSettled([
      settlement.release(
        order.id,
        fixture.users.requesterAdmin.id,
        'Verified source funds; send payout',
        'synthetic-release-key',
      ),
      settlement.release(
        order.id,
        fixture.users.approverAdminA.id,
        'Verified source funds; send payout',
        'another-release-key',
      ),
    ]);
    expect(
      paystack.request.mock.calls.filter(([, path]) => path === '/transfer'),
    ).toHaveLength(1);
    expect(
      (
        await db.transaction.findUniqueOrThrow({
          where: { id: order.transactionId },
        })
      ).status,
    ).toBe('PENDING');
    expect(
      await db.transferAttempt.count({
        where: { transactionId: order.transactionId },
      }),
    ).toBe(1);
  });
  it('does not refund a timeout, then compensates a verified failure exactly once', async () => {
    const order = await service.create(
      fixture.users.sender.id,
      (await quote()).id,
      '1234',
      'synthetic-exchange-key',
    );
    await settlement.release(
      order.id,
      fixture.users.requesterAdmin.id,
      'Verified source funds; send payout',
      'synthetic-release-key',
    );
    const row = await db.providerExchangeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    await expect(settlement.reconcile(row.payoutReference!)).rejects.toThrow();
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('989.90');
    verification = {
      reference: row.payoutReference,
      status: 'failed',
      currency: 'NGN',
      amount: 100000,
      recipient: {
        details: { account_number: '0123456789', bank_code: '058' },
      },
    };
    await settlement.reconcile(row.payoutReference!);
    await settlement.reconcile(row.payoutReference!);
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('1000.00');
  });
  it('rejects a wrong-recipient success and does not let stale failure overwrite success', async () => {
    const order = await service.create(
      fixture.users.sender.id,
      (await quote()).id,
      '1234',
      'synthetic-exchange-key',
    );
    await settlement.release(
      order.id,
      fixture.users.requesterAdmin.id,
      'Verified source funds; send payout',
      'synthetic-release-key',
    );
    const row = await db.providerExchangeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    verification = {
      reference: row.payoutReference,
      status: 'success',
      currency: 'NGN',
      amount: 100000,
      recipient: {
        details: { account_number: '9999999999', bank_code: '058' },
      },
    };
    await expect(settlement.reconcile(row.payoutReference!)).rejects.toThrow();
    (
      verification.recipient as { details: { account_number: string } }
    ).details.account_number = '0123456789';
    await settlement.reconcile(row.payoutReference!);
    verification.status = 'failed';
    await settlement.reconcile(row.payoutReference!);
    expect(
      (
        await db.providerExchangeOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).status,
    ).toBe('SENT');
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('989.90');
  });
  it('uses only GHS for ordinary MoMo cash-out and replays without another debit', async () => {
    const input = {
      amount: '20.00',
      mobileNumber: '233241234567',
      operator: 'mtn-gh',
      transactionPin: '1234',
    };
    const first = await withdrawals.create(
      fixture.users.sender.id,
      input,
      'synthetic-ghs-withdrawal',
    );
    const replay = await withdrawals.create(
      fixture.users.sender.id,
      input,
      'synthetic-ghs-withdrawal',
    );
    expect(replay.reference).toBe(first.reference);
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('980.00');
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'NGN')).toFixed(2),
    ).toBe('1000.00');
    expect(
      kora.request.mock.calls.filter(
        ([, path]) => path === '/transactions/disburse',
      ),
    ).toHaveLength(1);
    verification = {
      reference: first.reference,
      status: 'failed',
      amount: '20.00',
      currency: 'GHS',
      mobile_money: {
        mobile_number: input.mobileNumber,
        operator: input.operator,
      },
    };
    await withdrawals.reconcile(first.reference);
    await withdrawals.reconcile(first.reference);
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('1000.00');
  });
  it('funds a direct external MoMo order once without crediting its wallet', async () => {
    const q = await service.quote(fixture.users.sender.id, {
      sourceCurrency: 'GHS',
      fundingSource: 'EXTERNAL',
      amount: '10.00',
      destinationCode: '058',
      destinationNumber: '0123456789',
    });
    const order = await service.create(
      fixture.users.sender.id,
      q.id,
      '1234',
      'synthetic-external-order',
    );
    const providerReference = `KPY-${order.id}`;
    kora.request.mockImplementation(
      async (method: string, path: string, body: Record<string, unknown>) => {
        if (method === 'POST' && path === '/charges/mobile-money')
          return {
            currency: 'GHS',
            amount: '10.00',
            payment_reference: body.reference,
            transaction_reference: providerReference,
            auth_model: 'STK_PROMPT',
          };
        return {
          reference: providerReference,
          currency: 'GHS',
          amount: '10.00',
          amount_paid: '10.00',
          fee: '0.10',
          status: 'success',
        };
      },
    );
    const collections = new KoraCollectionsService(
      db as never,
      kora as never,
      new LedgerService(db as never),
      { get: () => ({ momoCollections: true, exchange: true }) } as never,
      config,
    );
    await collections.createMomoIntent(
      fixture.users.sender.id,
      order.id,
      { mobileNumber: '233241234567' },
      'synthetic-momo-intent',
    );
    await collections.confirmCharge(providerReference);
    await collections.confirmCharge(providerReference);
    expect(
      (
        await db.providerExchangeOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).status,
    ).toBe('READY');
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('1000.00');
    expect(
      await db.paymentNotification.count({ where: { orderId: order.id } }),
    ).toBe(1);
  });
  it('does not accept another owner or an expired quote', async () => {
    const q = await quote();
    await expect(
      service.create(
        fixture.users.recipientA.id,
        q.id,
        '1234',
        'synthetic-other-owner',
      ),
    ).rejects.toThrow('not found');
    await db.providerExchangeQuote.update({
      where: { id: q.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      service.create(
        fixture.users.sender.id,
        q.id,
        '1234',
        'synthetic-expired-quote',
      ),
    ).rejects.toThrow('expired');
    expect(
      await db.providerExchangeOrder.count({
        where: { userId: fixture.users.sender.id },
      }),
    ).toBe(0);
  });
  it('sends reverse-corridor cedis through Kora, never the Paystack transfer endpoint', async () => {
    const q = await service.quote(fixture.users.sender.id, {
      sourceCurrency: 'NGN',
      fundingSource: 'WALLET',
      amount: '10.00',
      destinationCode: 'mtn-gh',
      destinationNumber: '233241234567',
    });
    const order = await service.create(
      fixture.users.sender.id,
      q.id,
      '1234',
      'synthetic-reverse-order',
    );
    await settlement.release(
      order.id,
      fixture.users.requesterAdmin.id,
      'Verified funds; release cedi payout',
      'synthetic-reverse-send',
    );
    const record = await db.providerExchangeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(
      kora.request.mock.calls.filter(
        ([, path]) => path === '/transactions/disburse',
      ),
    ).toHaveLength(1);
    expect(
      paystack.request.mock.calls.filter(([, path]) => path === '/transfer'),
    ).toHaveLength(0);
    verification = {
      reference: record.payoutReference,
      currency: 'GHS',
      amount: q.targetAmount,
      status: 'success',
      mobile_money: { mobile_number: '233241234567', operator: 'mtn-gh' },
    };
    await settlement.reconcile(record.payoutReference!);
    expect(
      (
        await db.providerExchangeOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).status,
    ).toBe('SENT');
  });
});
