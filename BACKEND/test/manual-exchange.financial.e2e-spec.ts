import { ProviderNotificationsService } from '../src/exchange/provider-notifications.service';
import { randomUUID, createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { ManualExchangeService } from '../src/exchange/manual-exchange.service';
import { allocateDepositReference } from '../src/common/services/deposit-allocation';
import { Decimal } from '@prisma/client/runtime/library';
import { ManualExchangeReconciliationService } from '../src/exchange/manual-exchange-reconciliation.service';
import { LedgerService } from '../src/wallets/ledger.service';
import { TierOneLimitsService } from '../src/common/services/tier-one-limits.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RateService } from '../src/exchange/providers/rate.service';
import { TransactionPinService } from '../src/common/services/transaction-pin.service';
import { SupabaseService } from '../src/supabase/supabase.service';
import {
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  cleanupFinancialTransferFixture,
  FinancialTransferFixture,
} from './support/transfer-fixtures';
import type { SettlementMode } from '../src/exchange/manual-exchange.policy';

describe('manual exchange financial boundaries (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fixture: FinancialTransferFixture;
  let service: ManualExchangeService;
  let objects: Map<string, Buffer>;
  const pdf = Buffer.from('%PDF-1.7\nSynthetic receipt proof');
  const config = new ConfigService({
    MANUAL_EXCHANGE_ENABLED: 'true',
    MANUAL_EXCHANGE_COLLECTION_BANK_NAME: 'Test Bank',
    MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NAME: 'Test Collection',
    MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NUMBER: '0001112223',
    MANUAL_EXCHANGE_COLLECTION_VERSION: 'test-v1',
    MANUAL_EXCHANGE_GHS_COLLECTION_BANK_NAME: 'Test MoMo',
    MANUAL_EXCHANGE_GHS_COLLECTION_ACCOUNT_NAME: 'Synthetic Collection',
    MANUAL_EXCHANGE_GHS_COLLECTION_ACCOUNT_NUMBER: '0240000000',
    MANUAL_EXCHANGE_GHS_COLLECTION_VERSION: 'test-ghs-v1',
  });
  const makeService = (
    ledger?: LedgerService,
    rates?: RateService,
    database: unknown = prisma,
  ) =>
    new ManualExchangeService(
      database as PrismaService,
      config,
      (rates ?? {
        getRate: jest.fn().mockImplementation(async (source: string) => ({
          rate: source === 'GHS' ? 100 : 0.02,
          markup: 0,
          isStale: false,
        })),
      }) as unknown as RateService,
      ledger ?? new LedgerService(prisma as PrismaService),
      { verifyRequired: jest.fn() } as unknown as TransactionPinService,
      {
        createSignedUploadUrl: jest.fn().mockImplementation((_bucket, key) =>
          Promise.resolve({
            signedUrl: 'https://storage.example.invalid/' + key,
            token: 'synthetic',
          }),
        ),
        createSignedReadUrl: jest
          .fn()
          .mockResolvedValue('https://storage.example.invalid/read'),
        getAdminClient: () => ({
          storage: {
            from: () => ({
              info: async (key: string) => ({
                data: objects.has(key)
                  ? { size: objects.get(key)!.length }
                  : null,
                error: null,
              }),
              download: async (key: string) => ({
                data: objects.has(key)
                  ? new Blob([new Uint8Array(objects.get(key)!)])
                  : null,
                error: null,
              }),
            }),
          },
        }),
      } as unknown as SupabaseService,
      { info: jest.fn() } as unknown as PinoLogger,
    );
  beforeAll(async () => {
    prisma = createFinancialTestPrisma();
    await prisma.$connect();
  });
  beforeEach(async () => {
    fixture = await createFinancialTransferFixture(prisma, {
      createPolicies: false,
    });
    objects = new Map();
    service = makeService();
  });
  afterEach(async () => {
    const users = Object.values(fixture.users).map((u) => u.id);
    const orders = await prisma.manualExchangeOrder.findMany({
      where: { userId: { in: users } },
      select: { id: true },
    });
    const ids = orders.map((o) => o.id);
    await prisma.paymentNotification.deleteMany({
      where: { orderId: { in: ids } },
    });
    await prisma.exchangeDepositAllocation.deleteMany({
      where: { settlementId: { in: ids } },
    });
    await prisma.manualExchangeEvent.deleteMany({
      where: { orderId: { in: ids } },
    });
    await prisma.manualExchangeProof.deleteMany({
      where: { orderId: { in: ids } },
    });
    await prisma.manualExchangeOrder.deleteMany({ where: { id: { in: ids } } });
    await cleanupFinancialTransferFixture(prisma, fixture);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const user = () => fixture.users.sender.id;
  const admin = () => fixture.users.approverAdminA.id;
  const otherAdmin = () => fixture.users.approverAdminB.id;
  // Seed pre-policy rows explicitly: production never reclassifies historical customer choices.
  async function seedLegacyWallet(key: string, source: 'NGN' | 'GHS' = 'NGN') {
    const target = source === 'NGN' ? 'GHS' : 'NGN';
    const targetAmount = source === 'NGN' ? '2.00' : '10000.00';
    const hash = (text: string) =>
      createHash('sha256').update(text).digest('hex');
    const keyHash = hash(key),
      fingerprint = hash(
        JSON.stringify({
          ...(source === 'GHS' ? { sourceCurrency: source } : {}),
          amount: '100.00',
          settlementMode: 'WALLET',
        }),
      );
    try {
      await prisma.$transaction(async (tx) => {
        if (
          await tx.manualExchangeOrder.findUnique({
            where: {
              userId_createKeyHash: { userId: user(), createKeyHash: keyHash },
            },
          })
        )
          return;
        const reference = 'MEX-' + randomUUID().toUpperCase();
        const transaction = await tx.transaction.create({
          data: {
            userId: user(),
            type: 'EXCHANGE',
            currency: source,
            amount: '100.00',
            fee: '0.00',
            reference,
            metadata: {
              flow: 'MANUAL_EXCHANGE',
              settlementMode: 'WALLET',
              targetCurrency: target,
              targetAmount,
            },
          },
        });
        await tx.manualExchangeOrder.create({
          data: {
            userId: user(),
            transactionId: transaction.id,
            reference,
            createKeyHash: keyHash,
            createRequestHash: fingerprint,
            settlementMode: 'WALLET',
            payoutWorkflow: 'LEGACY',
            sourceCurrency: source,
            targetCurrency: target,
            amount: '100.00',
            targetAmount,
            rate: source === 'NGN' ? '0.020000' : '100.000000',
            fee: '0.00',
            collectionAccount: {
              bankName: source === 'GHS' ? 'Test MoMo' : 'Test Bank',
              accountName: 'Test Collection',
              accountNumber: '0001112223',
              version: 'test-v1',
              currency: source,
            },
            expiresAt: new Date(Date.now() + 1800000),
            events: {
              create: {
                actorId: user(),
                action: 'CREATE',
                keyHash,
                requestHash: fingerprint,
                status: 'AWAITING_TRANSFER',
                reason: 'Historical customer exchange request',
              },
            },
          },
        });
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
    }
  }
  async function legacyReverse(key = randomUUID()) {
    await seedLegacyWallet(key, 'GHS');
    return service.create(
      user(),
      {
        sourceCurrency: 'GHS',
        amount: '100.00',
        settlementMode: 'WALLET',
        transactionPin: '2468',
      },
      key,
    );
  }
  async function order(mode: SettlementMode = 'WALLET', key = randomUUID()) {
    if (mode === 'WALLET') await seedLegacyWallet(key);
    return service.create(
      user(),
      {
        amount: '100.00',
        settlementMode: mode,
        transactionPin: '2468',
        ...(mode === 'WALLET'
          ? {}
          : {
              destinationInstitution: 'Test MoMo',
              destinationAccount: '0240000000',
              destinationName: 'Synthetic Recipient',
            }),
      },
      key,
    );
  }
  async function attach(id: string) {
    const upload = await service.uploadUrl(
      id,
      user(),
      {
        fileName: 'proof.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
    );
    objects.set(upload.objectKey, pdf);
    return service.attach(
      id,
      user(),
      { objectKey: upload.objectKey, bankReference: 'BANK-' + randomUUID() },
      randomUUID(),
    );
  }
  const confirm = (depositReference: string) => ({
    action: 'CREDIT_WALLET' as const,
    reason: 'Verified exact incoming bank settlement',
    actualAmount: '100.00',
    depositReference,
  });
  async function balance() {
    return (
      await prisma.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId: user(), currency: 'GHS' } },
      })
    ).balance;
  }

  const bankOrder = (amount = '100.00') => ({
    deliveryPolicyVersion: 2 as const,
    sourceCurrency: 'GHS' as const,
    settlementMode: 'BANK' as const,
    amount,
    destinationInstitution: 'Synthetic Nigerian Bank',
    destinationAccount: '0123456789',
    destinationName: 'Synthetic Beneficiary',
    transactionPin: '2468',
  });

  it('refuses an old client reverse-bank request before collecting money', async () => {
    const oldClient = { ...bankOrder(), deliveryPolicyVersion: undefined };
    await expect(
      service.create(user(), oldClient, randomUUID()),
    ).rejects.toThrow('Update');
    expect(
      await prisma.manualExchangeOrder.count({ where: { userId: user() } }),
    ).toBe(0);
  });

  it('recovers a historical bank attempt before the client-version and availability gates', async () => {
    const key = randomUUID();
    const created = await service.create(user(), bankOrder(), key);
    const oldClient = { ...bankOrder(), deliveryPolicyVersion: undefined };
    await prisma.manualExchangeOrder.update({
      where: { id: created.id },
      data: {
        payoutWorkflow: 'LEGACY',
        createRequestHash: createHash('sha256')
          .update(
            '{"sourceCurrency":"GHS","amount":"100.00","settlementMode":"BANK","destinationInstitution":"Synthetic Nigerian Bank","destinationAccount":"0123456789","destinationName":"Synthetic Beneficiary"}',
          )
          .digest('hex'),
      },
    });
    config.set('MANUAL_EXCHANGE_ENABLED', 'false');
    try {
      const replay = await service.create(user(), oldClient, key);
      expect(replay.id).toBe(created.id);
      expect(replay.payoutWorkflow).toBe('LEGACY');
    } finally {
      config.set('MANUAL_EXCHANGE_ENABLED', 'true');
    }
  });

  it('does not charge direct exchange against subsequent wallet spending', async () => {
    await prisma.user.update({
      where: { id: user() },
      data: { kycTier: 'TIER_1' },
    });
    await service.create(
      user(),
      {
        ...bankOrder('1000000.00'),
        sourceCurrency: 'NGN',
        settlementMode: 'MOMO',
      },
      randomUUID(),
    );
    const ledger = new LedgerService(
      prisma as PrismaService,
      undefined,
      new TierOneLimitsService(
        new ConfigService({
          TIER_ONE_NGN_PER_TRANSACTION: '100',
          TIER_ONE_NGN_DAILY: '200',
          TIER_ONE_NGN_MAX_BALANCE: '3000',
        }),
      ),
    );
    const debit = () =>
      prisma.$transaction(async (tx) => {
        const reference = 'VTU-' + randomUUID();
        const transaction = await tx.transaction.create({
          data: {
            userId: user(),
            reference,
            type: 'AIRTIME',
            currency: 'NGN',
            amount: '50.00',
          },
        });
        return ledger.debitWallet(
          {
            userId: user(),
            currency: 'NGN',
            amount: new Decimal(50),
            transactionId: transaction.id,
            reference,
            source: 'VTU_PURCHASE',
          },
          tx,
        );
      });
    for (let i = 0; i < 4; i++) await debit();
    await expect(debit()).rejects.toThrow('daily');
    expect(
      (
        await prisma.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId: user(), currency: 'NGN' } },
        })
      ).balance.toFixed(2),
    ).toBe('800.00');
  });

  it('records order time and expiry from the database even if the app server clock is wrong', async () => {
    const [{ now }] = await prisma.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS "now"`;
    try {
      jest.useFakeTimers({
        now: Date.now() + 2 * 86400000,
        doNotFake: [
          'hrtime',
          'performance',
          'nextTick',
          'queueMicrotask',
          'setImmediate',
          'clearImmediate',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
        ],
      });
      const created = await service.create(user(), bankOrder(), randomUUID());
      expect(
        Math.abs(created.createdAt.getTime() - now.getTime()),
      ).toBeLessThan(5000);
      expect(created.expiresAt.getTime() - created.createdAt.getTime()).toBe(
        1800000,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('settles cedis directly to a Nigerian bank for an unverified customer without a wallet tier', async () => {
    await prisma.user.update({
      where: { id: user() },
      data: { kycTier: 'TIER_0', kycStatus: 'PENDING' },
    });
    await prisma.wallet.deleteMany({ where: { userId: user() } });
    const key = randomUUID();
    const created = await service.create(user(), bankOrder(), key);
    expect(created).toMatchObject({
      settlementMode: 'BANK',
      payoutWorkflow: 'ADMIN_EXTERNAL',
      targetAmount: '10000.00',
      status: 'AWAITING_TRANSFER',
      collectionAccount: { currency: 'GHS', bankName: 'Test MoMo' },
    });
    expect((await service.recoverCreated(user(), key)).id).toBe(created.id);
    await expect(
      service.recoverCreated(fixture.users.recipientA.id, key),
    ).rejects.toThrow('Exchange request not found');
    expect((await service.create(user(), bankOrder(), key)).id).toBe(
      created.id,
    );
    await attach(created.id);
    expect((await service.get(created.id, user())).status).toBe(
      'AWAITING_CONFIRMATION',
    );
    const second = await service.create(
      user(),
      bankOrder('200.00'),
      randomUUID(),
    );
    expect(second.id).not.toBe(created.id);
    expect(second.status).toBe('AWAITING_TRANSFER');
    expect((await service.get(created.id, user())).status).toBe(
      'AWAITING_CONFIRMATION',
    );
    const receipt = {
      ...confirm('GHS-DEP-' + randomUUID()),
      action: 'CONFIRM_DEPOSIT' as const,
    };
    await service.review(created.id, admin(), receipt, randomUUID());
    expect((await service.get(created.id, user())).status).toBe(
      'PAYOUT_PENDING',
    );
    await expect(
      service.review(
        created.id,
        admin(),
        { ...receipt, action: 'CREDIT_WALLET' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await service.review(
      created.id,
      admin(),
      {
        action: 'CLAIM_PAYOUT',
        reason: 'Taking ownership of verified naira payout',
      },
      randomUUID(),
    );
    const upload = await service.uploadUrl(
      created.id,
      admin(),
      {
        fileName: 'payout.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
      true,
    );
    objects.set(upload.objectKey, pdf);
    const payout = {
      action: 'RECORD_PAYOUT_SENT' as const,
      payoutReference: 'NGN-OUT-' + randomUUID(),
      payoutAmount: '10000.00',
      payoutProofObjectKey: upload.objectKey,
      reason: 'Verified the completed naira bank transfer and beneficiary',
    };
    await expect(
      service.review(created.id, otherAdmin(), payout, randomUUID()),
    ).rejects.toThrow();
    await expect(
      service.review(
        created.id,
        admin(),
        { ...payout, payoutAmount: '9999.99' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      service.review(
        created.id,
        admin(),
        { ...payout, action: 'MARK_SENT' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const reviewKey = randomUUID();
    await Promise.all([
      service.review(created.id, admin(), payout, reviewKey),
      service.review(created.id, admin(), payout, reviewKey),
    ]);
    expect((await service.get(created.id, user())).status).toBe('COMPLETED');
    expect(await prisma.wallet.count({ where: { userId: user() } })).toBe(0);
    const row = await prisma.manualExchangeOrder.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(
      await prisma.ledgerEntry.count({
        where: { transactionId: row.transactionId },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.transaction.findUniqueOrThrow({
          where: { id: row.transactionId },
        })
      ).status,
    ).toBe('SUCCESS');
  });

  it('accepts repeated large direct exchanges with no daily cap while deduplicating concurrent retries', async () => {
    const key = randomUUID();
    const [first, replay, second] = await Promise.all([
      service.create(user(), bankOrder('25000000.00'), key),
      service.create(user(), bankOrder('25000000.00'), key),
      service.create(user(), bankOrder('25000000.00'), randomUUID()),
    ]);
    expect(first.id).toBe(replay.id);
    expect(second.id).not.toBe(first.id);
    expect(first.targetAmount).toBe('2500000000.00');
    expect(
      await prisma.manualExchangeOrder.count({ where: { userId: user() } }),
    ).toBe(2);
  });

  it.each(['012345678', '01234567890', '+1234567890'])(
    'rejects malformed Nigerian beneficiary %s before instructions',
    async (destinationAccount) => {
      await expect(
        service.create(
          user(),
          { ...bankOrder(), destinationAccount },
          randomUUID(),
        ),
      ).rejects.toThrow();
      expect(
        await prisma.manualExchangeOrder.count({ where: { userId: user() } }),
      ).toBe(0);
    },
  );

  it('accepts large amounts in both directions for a verified Tier 1 customer without a wallet', async () => {
    await prisma.user.update({
      where: { id: user() },
      data: { kycTier: 'TIER_1' },
    });
    await prisma.wallet.deleteMany({ where: { userId: user() } });
    const ngn = await service.create(
      user(),
      {
        ...bankOrder('250000000000.00'),
        sourceCurrency: 'NGN',
        settlementMode: 'MOMO',
        destinationInstitution: 'Synthetic Ghana MoMo',
        destinationAccount: '0240000000',
      },
      randomUUID(),
    );
    const ghs = await service.create(
      user(),
      bankOrder('25000000.00'),
      randomUUID(),
    );
    expect(ngn.amount).toBe('250000000000.00');
    expect(ghs.amount).toBe('25000000.00');
    expect(await prisma.wallet.count({ where: { userId: user() } })).toBe(0);
    expect(
      await prisma.manualExchangeOrder.count({ where: { userId: user() } }),
    ).toBe(2);
  });

  it.each([
    ['NGN', 'WALLET'],
    ['GHS', 'MOMO'],
  ] as const)(
    'rejects unsupported new %s/%s delivery without creating an obligation',
    async (sourceCurrency, settlementMode) => {
      await expect(
        service.create(
          user(),
          {
            sourceCurrency,
            settlementMode,
            amount: '100.00',
            transactionPin: '2468',
            ...(settlementMode === 'WALLET'
              ? {}
              : {
                  destinationInstitution: 'Test MoMo',
                  destinationAccount: '0240000000',
                  destinationName: 'Test Recipient',
                }),
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      expect(
        await prisma.manualExchangeOrder.count({ where: { userId: user() } }),
      ).toBe(0);
    },
  );
  it('blocks payout ownership before an operator pays while reconciliation is on hold', async () => {
    const created = await order('MOMO');
    await attach(created.id);
    await service.review(
      created.id,
      admin(),
      { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
      randomUUID(),
    );
    const hold = await prisma.reconciliationRun.create({
      data: { scope: 'MANUAL_EXCHANGE', status: 'BLOCKED', mismatchCount: 1 },
    });
    try {
      await expect(
        service.review(
          created.id,
          admin(),
          {
            action: 'CLAIM_PAYOUT',
            reason: 'Trying to start the cedi payout during a hold',
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      const current = await service.get(created.id, user());
      expect(current.status).toBe('PAYOUT_PENDING');
      expect(current.payoutClaimedBy).toBeNull();
      expect(
        await prisma.manualExchangeEvent.count({
          where: { orderId: created.id, action: 'CLAIM_PAYOUT' },
        }),
      ).toBe(0);
    } finally {
      await prisma.reconciliationRun.delete({ where: { id: hold.id } });
    }
  });
  it.each(['suspended', 'pin-reset'] as const)(
    'rechecks %s eligibility before a payout is claimed',
    async (reason) => {
      const created = await order('MOMO');
      await attach(created.id);
      await service.review(
        created.id,
        admin(),
        { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
        randomUUID(),
      );
      if (reason === 'suspended')
        await prisma.user.update({
          where: { id: user() },
          data: { isSuspended: true },
        });
      else
        await prisma.transactionPinCredential.create({
          data: {
            userId: user(),
            salt: 'synthetic-test-only',
            hash: 'synthetic-test-only',
            iterations: 1,
            pinLength: 4,
            resetHoldUntil: new Date(Date.now() + 60000),
          },
        });
      await expect(
        service.review(
          created.id,
          admin(),
          {
            action: 'CLAIM_PAYOUT',
            reason: 'Checking current customer safety before paying',
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      const current = await service.get(created.id, user());
      expect(current.status).toBe('PAYOUT_PENDING');
      expect(current.payoutClaimedBy).toBeNull();
    },
  );
  it('keeps an older funded payout discoverable beyond one hundred newer closed requests', async () => {
    const old = await order('MOMO');
    await attach(old.id);
    await service.review(
      old.id,
      admin(),
      { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
      randomUUID(),
    );
    await prisma.manualExchangeOrder.update({
      where: { id: old.id },
      data: { createdAt: new Date('2000-01-01') },
    });
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      transactionId: randomUUID(),
      reference: 'CLOSED-' + randomUUID(),
      createdAt: new Date(Date.now() + index + 1000),
    }));
    await prisma.transaction.createMany({
      data: rows.map((r) => ({
        id: r.transactionId,
        userId: user(),
        type: 'EXCHANGE' as const,
        status: 'FAILED' as const,
        currency: 'GHS' as const,
        amount: '100.00',
        reference: r.reference,
      })),
    });
    await prisma.manualExchangeOrder.createMany({
      data: rows.map((r) => ({
        id: r.id,
        transactionId: r.transactionId,
        userId: user(),
        reference: r.reference,
        createKeyHash: randomUUID(),
        createRequestHash: 'synthetic-closed-history',
        status: 'REJECTED' as const,
        settlementMode: 'WALLET' as const,
        sourceCurrency: 'GHS' as const,
        targetCurrency: 'NGN' as const,
        amount: '100.00',
        targetAmount: '2.00',
        rate: '0.020000',
        fee: '0.00',
        collectionAccount: {
          bankName: 'Synthetic',
          accountName: 'Synthetic',
          accountNumber: '0240000000',
          currency: 'GHS',
          version: 'test',
        },
        createdAt: r.createdAt,
        expiresAt: new Date(Date.now() + 1800000),
      })),
    });
    const filteredFirst = await service.queue({ status: 'REJECTED' });
    expect(filteredFirst.nextCursor).toBeTruthy();
    const expectedRemaining = rows
      .filter((row) => !filteredFirst.items.some((item) => item.id === row.id))
      .map((row) => row.id);
    // Another operator resolves the boundary row while this operator browses.
    await prisma.manualExchangeOrder.update({
      where: { id: filteredFirst.nextCursor! },
      data: { status: 'NEEDS_MORE_INFO' },
    });
    const remaining = [] as string[];
    let filteredCursor = filteredFirst.nextCursor;
    while (filteredCursor) {
      const next = await service.queue({
        status: 'REJECTED',
        cursor: filteredCursor,
      });
      remaining.push(...next.items.map((item) => item.id));
      filteredCursor = next.nextCursor;
    }
    expect(remaining).toEqual(expect.arrayContaining(expectedRemaining));
    expect(new Set(remaining).size).toBe(remaining.length);
    const first = await service.queue({});
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    expect(first.items.some((item) => item.id === old.id)).toBe(false);
    const all = [...first.items];
    let cursor = first.nextCursor;
    for (let i = 0; cursor && i < 10; i++) {
      const page = await service.queue({ cursor });
      all.push(...page.items);
      cursor = page.nextCursor;
    }
    expect(all.some((item) => item.id === old.id)).toBe(true);
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    const filtered = await service.queue({ status: 'PAYOUT_PENDING' });
    expect(filtered.items.some((item) => item.id === old.id)).toBe(true);
    expect(filtered.counts.REJECTED).toBe(
      await prisma.manualExchangeOrder.count({ where: { status: 'REJECTED' } }),
    );
  });
  it('replays a historical cedi request and credits naira once across concurrent admins', async () => {
    const key = randomUUID(),
      dto = {
        sourceCurrency: 'GHS' as const,
        amount: '100.00',
        settlementMode: 'WALLET' as const,
        transactionPin: '2468',
      };
    await seedLegacyWallet(key, 'GHS');
    const created = await Promise.all([
      service.create(user(), dto, key),
      service.create(user(), dto, key),
    ]);
    expect(created[0].id).toBe(created[1].id);
    expect(created[0].targetCurrency).toBe('NGN');
    expect(created[0].targetAmount).toBe('10000.00');
    expect(
      await prisma.manualExchangeOrder.count({ where: { userId: user() } }),
    ).toBe(1);
    const before = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user(), currency: 'NGN' } },
    });
    await attach(created[0].id);
    const deposit = confirm('MOMO-' + randomUUID());
    const results = await Promise.allSettled([
      service.review(created[0].id, admin(), deposit, randomUUID()),
      service.review(created[0].id, otherAdmin(), deposit, randomUUID()),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const after = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user(), currency: 'NGN' } },
    });
    expect(after.balance.minus(before.balance).toFixed(2)).toBe('10000.00');
    const notifications = await prisma.paymentNotification.findMany({
      where: { orderId: created[0].id },
    });
    expect(notifications.filter((n) => n.audience === 'ADMIN')).toHaveLength(1);
    expect(
      notifications.filter((n) => n.audience === `USER:${user()}`),
    ).toHaveLength(1);
    expect(
      notifications.find((n) => n.audience === `USER:${user()}`)?.title,
    ).toContain('10000.00 NGN');
    const inbox = new ProviderNotificationsService(prisma as PrismaService);
    const userInbox = await inbox.list(user(), `USER:${user()}`);
    expect(userInbox).toHaveLength(1);
    expect(
      await inbox.list(
        fixture.users.recipientA.id,
        `USER:${fixture.users.recipientA.id}`,
      ),
    ).toEqual([]);
    const notificationId = userInbox[0].id;
    await expect(
      inbox.read(otherAdmin(), notificationId, randomUUID()),
    ).rejects.toThrow('Notification not found');
    await expect(
      inbox.read(
        fixture.users.recipientA.id,
        notificationId,
        randomUUID(),
        `USER:${fixture.users.recipientA.id}`,
      ),
    ).rejects.toThrow('Notification not found');
    const firstRead = await inbox.read(
      user(),
      notificationId,
      randomUUID(),
      `USER:${user()}`,
    );
    const retryRead = await inbox.read(
      user(),
      notificationId,
      randomUUID(),
      `USER:${user()}`,
    );
    expect(retryRead.readAt).toEqual(firstRead.readAt);
    expect(
      await prisma.paymentNotificationRead.count({ where: { notificationId } }),
    ).toBe(1);

    expect((await balance()).toFixed(2)).toBe('1000.00');
  });
  it('deduplicates retried payment submissions but alerts again for a corrected receipt', async () => {
    const created = await order('MOMO');
    const upload = await service.uploadUrl(
      created.id,
      user(),
      {
        fileName: 'proof.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
    );
    objects.set(upload.objectKey, pdf);
    const proof = {
      objectKey: upload.objectKey,
      bankReference: 'BANK-' + randomUUID(),
    };
    const key = randomUUID();
    await Promise.allSettled([
      service.attach(created.id, user(), proof, key),
      service.attach(created.id, user(), proof, key),
    ]);
    await service.attach(created.id, user(), proof, key);
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: created.id, audience: 'ADMIN' },
      }),
    ).toBe(1);
    await service.review(
      created.id,
      admin(),
      {
        action: 'REQUEST_INFO',
        reason: 'Please attach the complete payment receipt',
      },
      randomUUID(),
    );
    await attach(created.id);
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: created.id, audience: 'ADMIN' },
      }),
    ).toBe(2);
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: created.id, audience: `USER:${user()}` },
      }),
    ).toBe(0);
  });
  it('keeps notification content server-only even if a Data API role is accidentally granted table reads', async () => {
    const created = await order('MOMO');
    await attach(created.id);
    const protections = await prisma.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean }>
    >`SELECT relname, relrowsecurity FROM pg_class WHERE oid IN ('public.payment_notifications'::regclass, 'public.payment_notification_reads'::regclass)`;
    expect(protections).toHaveLength(2);
    expect(protections.every((row) => row.relrowsecurity)).toBe(true);
    const rollback = new Error('rollback test-only privileges');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'GRANT SELECT ON payment_notifications, payment_notification_reads TO anon',
        );
        await tx.$executeRawUnsafe('SET LOCAL ROLE anon');
        expect(await tx.paymentNotification.findMany()).toEqual([]);
        expect(await tx.paymentNotificationRead.findMany()).toEqual([]);
        await tx.$executeRawUnsafe('RESET ROLE');
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it('keeps an older unread customer alert accessible beyond fifty newer read items', async () => {
    const created = await order('MOMO');
    const older = await prisma.paymentNotification.create({
      data: {
        eventKey: `${created.id}:old`,
        audience: `USER:${user()}`,
        orderId: created.id,
        title: 'Older unpaid attention',
        createdAt: new Date('2020-01-01'),
      },
    });
    for (let index = 0; index < 50; index++) {
      const newer = await prisma.paymentNotification.create({
        data: {
          eventKey: `${created.id}:new-${index}`,
          audience: `USER:${user()}`,
          orderId: created.id,
          title: 'Already read update',
        },
      });
      await prisma.paymentNotificationRead.create({
        data: { notificationId: newer.id, adminId: user() },
      });
    }
    const inbox = new ProviderNotificationsService(prisma as PrismaService);
    expect(
      (await inbox.list(user(), `USER:${user()}`)).some(
        (n) => n.id === older.id,
      ),
    ).toBe(true);
    expect(await (inbox as any).countUnread(user(), `USER:${user()}`)).toBe(1);
    expect(
      await (inbox as any).countUnread(
        fixture.users.recipientA.id,
        `USER:${fixture.users.recipientA.id}`,
      ),
    ).toBe(0);
    await inbox.read(user(), older.id, randomUUID(), `USER:${user()}`);
    expect(await (inbox as any).countUnread(user(), `USER:${user()}`)).toBe(0);
  });
  it('rolls back wallet credit and approval if its durable notification cannot be saved, then retries once', async () => {
    const created = await legacyReverse(randomUUID());
    await attach(created.id);
    const before = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user(), currency: 'NGN' } },
    });
    const failingDatabase = prisma.$extends({
      query: {
        paymentNotification: {
          async createMany({ args, query }) {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            if (rows.some((row) => row.audience?.startsWith('USER:')))
              throw new Error('Simulated durable notification save failure');
            return query(args);
          },
        },
      },
    });
    const failingService = makeService(undefined, undefined, failingDatabase);
    const input = confirm('DEP-' + randomUUID());
    const key = randomUUID();
    await expect(
      failingService.review(created.id, admin(), input, key),
    ).rejects.toThrow('Simulated durable notification save failure');
    expect((await service.get(created.id, user())).status).toBe(
      'AWAITING_CONFIRMATION',
    );
    const after = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user(), currency: 'NGN' } },
    });
    expect(after.balance).toEqual(before.balance);
    expect(
      await prisma.exchangeDepositAllocation.count({
        where: { settlementId: created.id },
      }),
    ).toBe(0);
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: created.id, audience: `USER:${user()}` },
      }),
    ).toBe(0);
    await service.review(created.id, admin(), input, key);
    await service.review(created.id, admin(), input, key);
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: created.id, audience: `USER:${user()}` },
      }),
    ).toBe(1);
  });
  it('uses the saved admin rate without a feed and preserves an order price after the admin changes it', async () => {
    const where = { from_to: { from: 'GHS', to: 'NGN' } };
    const original = await prisma.rate.findUnique({ where });
    const http = { get: jest.fn() };
    const rates = new RateService(
      prisma as PrismaService,
      new ConfigService({ FX_RATE_SOURCE: 'admin' }),
      http as never,
      { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined) } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    );
    try {
      await rates.setManualRate(
        'GHS',
        'NGN',
        100,
        0,
        admin(),
        'Synthetic approved merchant rate',
      );
      await prisma.rate.update({
        where,
        data: { updatedAt: new Date(Date.now() - 7 * 86400000) },
      });
      service = makeService(undefined, rates);
      const created = await service.create(user(), bankOrder(), randomUUID());
      expect(created.targetAmount).toBe('10000.00');
      await rates.setManualRate(
        'GHS',
        'NGN',
        125.5,
        0,
        otherAdmin(),
        'Synthetic replacement merchant rate',
      );
      expect((await rates.getRate('GHS', 'NGN')).rate).toBe(125.5);
      await attach(created.id);
      const review = {
        ...confirm('ADMIN-RATE-' + randomUUID()),
        action: 'CONFIRM_DEPOSIT' as const,
      };
      const key = randomUUID();
      await service.review(created.id, admin(), review, key);
      await service.review(created.id, admin(), review, key);
      const frozen = await service.get(created.id, user());
      expect(frozen.targetAmount).toBe('10000.00');
      expect(frozen.status).toBe('PAYOUT_PENDING');
      const row = await prisma.manualExchangeOrder.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(
        await prisma.ledgerEntry.count({
          where: { transactionId: row.transactionId },
        }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'FX_RATE_OVERRIDE',
            adminId: { in: [admin(), otherAdmin()] },
          },
        }),
      ).toBe(2);
      expect(http.get).not.toHaveBeenCalled();
    } finally {
      if (original) {
        await prisma.rate.update({
          where,
          data: {
            rate: original.rate,
            markup: original.markup,
            source: original.source,
            validUntil: original.validUntil,
            updatedAt: original.updatedAt,
          },
        });
      } else {
        await prisma.rate.deleteMany({ where: { from: 'GHS', to: 'NGN' } });
      }
    }
  });

  it('preserves historical GHS collection and credits NGN exactly once on replay', async () => {
    const before = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user(), currency: 'NGN' } },
    });
    const key = randomUUID();
    const created = await legacyReverse(key);
    expect(created.sourceCurrency).toBe('GHS');
    expect(created.targetCurrency).toBe('NGN');
    expect(created.collectionAccount).toMatchObject({
      currency: 'GHS',
      bankName: 'Test MoMo',
    });
    await expect(
      service.create(
        user(),
        { amount: '100.00', settlementMode: 'WALLET', transactionPin: '2468' },
        key,
      ),
    ).rejects.toThrow('different exchange details');
    await attach(created.id);
    const reviewKey = randomUUID();
    const review = confirm('GHS-DEP-' + randomUUID());
    await service.review(created.id, admin(), review, reviewKey);
    await service.review(created.id, admin(), review, reviewKey);
    const after = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user(), currency: 'NGN' } },
    });
    expect(after.balance.minus(before.balance).toFixed(2)).toBe(
      created.targetAmount,
    );
  });

  it('requires explicit approval of expired frozen terms, then reconciliation detects damaged credit evidence', async () => {
    const created = await order();
    await attach(created.id);
    await prisma.manualExchangeOrder.update({
      where: { id: created.id },
      data: { expiresAt: new Date(0) },
    });
    const dto = confirm('DEP-' + randomUUID());
    await expect(
      service.review(created.id, admin(), dto, randomUUID()),
    ).rejects.toThrow('quote expired');
    expect((await balance()).toFixed(2)).toBe('1000.00');
    const key = randomUUID();
    await service.review(
      created.id,
      admin(),
      { ...dto, acceptExpiredQuote: true },
      key,
    );
    await service.review(
      created.id,
      admin(),
      { ...dto, acceptExpiredQuote: true },
      key,
    );
    expect((await balance()).toFixed(2)).toBe('1002.00');
    const reconciliation = new ManualExchangeReconciliationService(
      prisma as PrismaService,
      { error: jest.fn() } as unknown as PinoLogger,
    );
    expect((await reconciliation.check()).mismatches).toEqual([]);
    const row = await prisma.manualExchangeOrder.findUniqueOrThrow({
      where: { id: created.id },
    });
    await prisma.ledgerEntry.updateMany({
      where: { transactionId: row.transactionId },
      data: { amount: '1.00' },
    });
    expect((await reconciliation.check()).mismatches).toContainEqual({
      reference: created.reference,
      code: 'WALLET_CREDIT_MISMATCH',
    });
  });
  it('rejects existing wallet funding and provider-event references, and rejects new wallet settlement before instructions', async () => {
    const created = await order();
    await attach(created.id);
    const reference = 'FUND-' + randomUUID();
    await prisma.transaction.create({
      data: {
        userId: user(),
        type: 'FUND',
        amount: '100',
        currency: 'NGN',
        status: 'SUCCESS',
        reference,
      },
    });
    await expect(
      service.review(created.id, admin(), confirm(reference), randomUUID()),
    ).rejects.toThrow('funding or exchange record');
    const providerReference = 'PROVIDER-' + randomUUID();
    const event = await prisma.providerEvent.create({
      data: {
        provider: 'MONNIFY',
        eventType: 'SUCCESSFUL_TRANSACTION',
        providerReference,
        status: 'PROCESSED',
        payload: {},
      },
    });
    try {
      await expect(
        service.review(
          created.id,
          admin(),
          confirm(providerReference),
          randomUUID(),
        ),
      ).rejects.toThrow('funding or exchange record');
    } finally {
      await prisma.providerEvent.delete({ where: { id: event.id } });
    }
    await prisma.wallet.delete({
      where: { userId_currency: { userId: user(), currency: 'NGN' } },
    });
    await expect(
      service.create(
        user(),
        {
          sourceCurrency: 'GHS',
          amount: '100.00',
          settlementMode: 'WALLET',
          transactionPin: '2468',
        },
        randomUUID(),
      ),
    ).rejects.toThrow('Choose a receiving bank');
  });
  it('makes webhook funding and manual approval compete for one global deposit allocation', async () => {
    const created = await order();
    await attach(created.id);
    const reference = 'RACE-' + randomUUID();
    const ledger = new LedgerService(prisma as PrismaService);
    const results = await Promise.allSettled([
      service.review(created.id, admin(), confirm(reference), randomUUID()),
      prisma.$transaction(async (tx) => {
        await allocateDepositReference(tx, {
          reference,
          settlementId: 'funding:' + randomUUID(),
          amount: new Decimal('100'),
          kind: 'FUNDING',
        });
        const transaction = await tx.transaction.create({
          data: {
            userId: user(),
            type: 'FUND',
            amount: '100',
            currency: 'NGN',
            status: 'SUCCESS',
            reference,
          },
        });
        await ledger.creditWallet(
          {
            userId: user(),
            currency: 'NGN',
            amount: new Decimal('100'),
            transactionId: transaction.id,
            reference,
            source: 'MONNIFY_DVA',
          },
          tx,
        );
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const ngn = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user(), currency: 'NGN' } },
    });
    const ghs = await balance();
    expect([[ngn.balance.toFixed(2), ghs.toFixed(2)]]).toEqual(
      expect.arrayContaining([
        results[0].status === 'fulfilled'
          ? ['1000.00', '1002.00']
          : ['1100.00', '1000.00'],
      ]),
    );
  });
  it('replays upload intent without storing signed credentials and rejects a changed upload body', async () => {
    const created = await order();
    const dto = {
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      fileSize: pdf.length,
    };
    const key = randomUUID();
    const [first, second] = await Promise.all([
      service.uploadUrl(created.id, user(), dto, key),
      service.uploadUrl(created.id, user(), dto, key),
    ]);
    expect(first.objectKey).toBe(second.objectKey);
    const rows = await prisma.manualExchangeProof.findMany({
      where: { orderId: created.id },
    });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('signedUrl');
    await expect(
      service.uploadUrl(created.id, user(), { ...dto, fileSize: 12 }, key),
    ).rejects.toThrow('different file');
  });
  it('replays a historical wallet request with stable instructions and immutable mode', async () => {
    const key = randomUUID();
    const results = await Promise.all([
      order('WALLET', key),
      order('WALLET', key),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results[0].targetAmount).toBe('2.00');
    await prisma.user.update({
      where: { id: user() },
      data: { kycTier: 'TIER_0', kycStatus: 'PENDING' },
    });
    expect((await order('WALLET', key)).id).toBe(results[0].id);
    await attach(results[0].id);
    await expect(
      service.review(
        results[0].id,
        admin(),
        confirm('DEP-' + randomUUID()),
        randomUUID(),
      ),
    ).rejects.toThrow('Verify your identity before crediting your wallet');
    expect((await balance()).toFixed(2)).toBe('1000.00');
    await expect(order('BANK', key)).rejects.toThrow(
      'different exchange details',
    );
    expect(
      await prisma.manualExchangeOrder.count({ where: { userId: user() } }),
    ).toBe(1);
  });
  it('survives a lost post-commit response; concurrent admins credit once and replay original reference', async () => {
    const created = await order();
    await attach(created.id);
    const reference = 'DEP-' + randomUUID(),
      key = randomUUID();
    const results = await Promise.allSettled([
      service.review(created.id, admin(), confirm(reference), key),
      service.review(
        created.id,
        otherAdmin(),
        confirm(reference),
        randomUUID(),
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const fresh = makeService();
    const current = await fresh.get(created.id, user());
    expect(current.status).toBe('CREDITED');
    expect(current.reference).toBe(created.reference);
    expect((await balance()).toFixed(2)).toBe('1002.00');
    expect(
      await prisma.ledgerEntry.count({
        where: {
          transactionId: (
            await prisma.manualExchangeOrder.findUniqueOrThrow({
              where: { id: created.id },
            })
          ).transactionId,
        },
      }),
    ).toBe(1);
    await expect(
      service.review(
        created.id,
        admin(),
        { action: 'CLAIM_PAYOUT', reason: 'Attempt alternate settlement' },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('rolls back status, deposit allocation, events and balance when ledger posting fails', async () => {
    const created = await order();
    await attach(created.id);
    const reference = 'DEP-' + randomUUID();
    const failing = makeService({
      creditWallet: async () => {
        throw new Error('synthetic ledger failure');
      },
    } as unknown as LedgerService);
    await expect(
      failing.review(created.id, admin(), confirm(reference), randomUUID()),
    ).rejects.toThrow('synthetic ledger failure');
    expect((await service.get(created.id, user())).status).toBe(
      'AWAITING_CONFIRMATION',
    );
    expect(
      await prisma.exchangeDepositAllocation.findUnique({
        where: { reference: reference.toUpperCase() },
      }),
    ).toBeNull();
    expect((await balance()).toFixed(2)).toBe('1000.00');
  });
  it('does not allocate one bank deposit to two orders', async () => {
    const a = await order(),
      b = await order();
    await attach(a.id);
    await attach(b.id);
    const reference = 'DEP-' + randomUUID();
    const result = await Promise.allSettled([
      service.review(a.id, admin(), confirm(reference), randomUUID()),
      service.review(b.id, otherAdmin(), confirm(reference), randomUUID()),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await balance()).toFixed(2)).toBe('1002.00');
  });
  it('completes an admin cedi transfer once with exact amount, owned claim and protected evidence', async () => {
    const created = await order('MOMO');
    await attach(created.id);
    await service.review(
      created.id,
      admin(),
      { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
      randomUUID(),
    );
    await service.review(
      created.id,
      admin(),
      {
        action: 'CLAIM_PAYOUT',
        reason: 'Assigned operator preparing cedi payment',
      },
      randomUUID(),
    );
    const upload = await service.uploadUrl(
      created.id,
      admin(),
      {
        fileName: 'paid.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
      true,
    );
    objects.set(upload.objectKey, pdf);
    const input = {
      action: 'RECORD_CEDIS_SENT' as const,
      reason: 'Verified actual cedi transfer after checking recipient',
      payoutReference: 'GHS-OUT-' + randomUUID(),
      payoutAmount: created.targetAmount,
      payoutProofObjectKey: upload.objectKey,
    };
    await expect(
      service.review(
        created.id,
        admin(),
        { ...input, payoutAmount: '999.99' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect((await service.get(created.id, user())).status).toBe(
      'PAYOUT_PROCESSING',
    );
    await expect(
      service.review(
        created.id,
        admin(),
        { ...input, action: 'MARK_SENT' },
        randomUUID(),
      ),
    ).rejects.toThrow('Confirm cedis sent');
    const key = randomUUID();
    const paid = await service.review(created.id, admin(), input, key);
    expect(paid.status).toBe('COMPLETED');
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: created.id, audience: 'ADMIN' },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: created.id, audience: `USER:${user()}` },
      }),
    ).toBe(2);

    expect((await service.review(created.id, admin(), input, key)).status).toBe(
      'COMPLETED',
    );
    expect(
      await prisma.paymentNotification.count({
        where: { orderId: created.id },
      }),
    ).toBe(3);
    const row = await prisma.manualExchangeOrder.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(
      (
        await prisma.transaction.findUniqueOrThrow({
          where: { id: row.transactionId },
        })
      ).status,
    ).toBe('SUCCESS');
    expect(
      await prisma.ledgerEntry.count({
        where: { transactionId: row.transactionId },
      }),
    ).toBe(0);
    expect((await balance()).toFixed(2)).toBe('1000.00');
    expect(
      await prisma.manualExchangeEvent.count({
        where: { orderId: row.id, action: 'RECORD_CEDIS_SENT' },
      }),
    ).toBe(1);
    await expect(
      service.review(created.id, otherAdmin(), input, randomUUID()),
    ).rejects.toThrow();
    const reconciliation = new ManualExchangeReconciliationService(
      prisma as PrismaService,
      { error: jest.fn() } as unknown as PinoLogger,
    );
    expect(
      (await reconciliation.check()).mismatches.filter(
        (r) => r.reference === created.reference,
      ),
    ).toEqual([]);
  });
  it('replays committed cedi completion without downloading proof again after a lost response', async () => {
    const created = await order('MOMO');
    await attach(created.id);
    await service.review(
      created.id,
      admin(),
      { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
      randomUUID(),
    );
    await service.review(
      created.id,
      admin(),
      {
        action: 'CLAIM_PAYOUT',
        reason: 'Assigned operator preparing cedi transfer',
      },
      randomUUID(),
    );
    const upload = await service.uploadUrl(
      created.id,
      admin(),
      {
        fileName: 'paid.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
      true,
    );
    objects.set(upload.objectKey, pdf);
    const dto = {
      action: 'RECORD_CEDIS_SENT' as const,
      reason: 'Statement checked and cedis received by the destination',
      payoutReference: 'OUT-' + randomUUID(),
      payoutAmount: created.targetAmount,
      payoutProofObjectKey: upload.objectKey,
    };
    const key = randomUUID();
    await service.review(created.id, admin(), dto, key);
    objects.delete(upload.objectKey);
    expect((await service.review(created.id, admin(), dto, key)).status).toBe(
      'COMPLETED',
    );
    expect(
      await prisma.manualExchangeEvent.count({
        where: { orderId: created.id, action: 'RECORD_CEDIS_SENT' },
      }),
    ).toBe(1);
    await expect(
      service.review(
        created.id,
        admin(),
        { ...dto, payoutReference: 'CHANGED-OUT' },
        key,
      ),
    ).rejects.toThrow('different details');
  });
  it('hands an actively claimed payout to another active admin only after a confirmed non-send outcome', async () => {
    const created = await order('MOMO');
    await attach(created.id);
    await service.review(
      created.id,
      admin(),
      { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
      randomUUID(),
    );
    await service.review(
      created.id,
      admin(),
      { action: 'CLAIM_PAYOUT', reason: 'Assigned operator preparing payout' },
      randomUUID(),
    );
    const evidence = await service.uploadHandoverUrl(
      created.id,
      otherAdmin(),
      {
        fileName: 'outcome-check.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
    );
    objects.set(evidence.objectKey, pdf);
    const input = {
      action: 'HANDOVER_PAYOUT' as const,
      reason:
        'Supervisor checked the bank statement and confirmed no payout was sent',
      handoverToAdminId: otherAdmin(),
      payoutOutcome: 'NOT_SENT' as const,
      payoutProofObjectKey: evidence.objectKey,
    };
    const beforeReference = created.reference;
    const handoverKey = randomUUID();
    const handedOver = await service.review(
      created.id,
      otherAdmin(),
      input,
      handoverKey,
    );
    expect(handedOver.status).toBe('PAYOUT_PROCESSING');
    expect(handedOver.payoutClaimedBy).toBe(otherAdmin());
    expect(handedOver.reference).toBe(beforeReference);
    const row = await prisma.manualExchangeOrder.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.payoutReference).toBeNull();
    expect(
      await prisma.manualExchangeEvent.count({
        where: { orderId: created.id, action: 'HANDOVER_PAYOUT' },
      }),
    ).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        targetType: 'ManualExchangeOrder',
        targetId: created.id,
        action: 'MANUAL_EXCHANGE_HANDOVER_PAYOUT',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.reference).toBe(beforeReference);
    expect((audit.metadata as { payoutOutcome?: string }).payoutOutcome).toBe(
      'NOT_SENT',
    );
    objects.delete(evidence.objectKey);
    expect(
      (await service.review(created.id, otherAdmin(), input, handoverKey))
        .status,
    ).toBe('PAYOUT_PROCESSING');
  });
  it('records an already-sent external payout during handover without authorizing another send', async () => {
    const created = await order('MOMO');
    await attach(created.id);
    await service.review(
      created.id,
      admin(),
      { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
      randomUUID(),
    );
    await service.review(
      created.id,
      admin(),
      { action: 'CLAIM_PAYOUT', reason: 'Assigned operator preparing payout' },
      randomUUID(),
    );
    const evidence = await service.uploadHandoverUrl(
      created.id,
      otherAdmin(),
      {
        fileName: 'already-sent.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
    );
    objects.set(evidence.objectKey, pdf);
    const payoutReference = 'OUT-' + randomUUID();
    const input = {
      action: 'HANDOVER_PAYOUT' as const,
      reason:
        'Supervisor checked the bank statement and confirmed the original payout settled',
      handoverToAdminId: otherAdmin(),
      payoutOutcome: 'ALREADY_SENT' as const,
      payoutReference,
      payoutAmount: created.targetAmount,
      payoutProofObjectKey: evidence.objectKey,
    };
    const result = await service.review(
      created.id,
      otherAdmin(),
      input,
      randomUUID(),
    );
    expect(result.status).toBe('PAYOUT_SENT');
    expect(result.reference).toBe(created.reference);
    expect(result.payoutReference).toBe(payoutReference.toUpperCase());
    expect(result.payoutClaimedBy).toBe(otherAdmin());
    await expect(
      service.review(
        created.id,
        otherAdmin(),
        { ...input, payoutReference: 'OUT-DUPLICATE' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const completeKey = randomUUID();
    const complete = {
      action: 'COMPLETE' as const,
      reason: 'Independently verified the already-sent payment settled',
    };
    expect(
      (await service.review(created.id, otherAdmin(), complete, completeKey))
        .status,
    ).toBe('COMPLETED');
    expect(
      (await service.review(created.id, otherAdmin(), complete, completeKey))
        .status,
    ).toBe('COMPLETED');
  });
  it('refuses an unknown payout outcome without changing the original owner', async () => {
    const created = await order('MOMO');
    await attach(created.id);
    await service.review(
      created.id,
      admin(),
      { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
      randomUUID(),
    );
    await service.review(
      created.id,
      admin(),
      { action: 'CLAIM_PAYOUT', reason: 'Assigned operator preparing payout' },
      randomUUID(),
    );
    await expect(
      service.review(
        created.id,
        otherAdmin(),
        {
          action: 'HANDOVER_PAYOUT',
          reason: 'Provider response is still unavailable for this payout',
          handoverToAdminId: otherAdmin(),
          payoutOutcome: 'UNKNOWN',
        },
        randomUUID(),
      ),
    ).rejects.toThrow('outcome is unknown');
    const current = await service.get(created.id, user());
    expect(current.status).toBe('PAYOUT_PROCESSING');
    expect(current.payoutClaimedBy).toBe(admin());
    expect(
      await prisma.manualExchangeEvent.count({
        where: { orderId: created.id, action: 'HANDOVER_PAYOUT' },
      }),
    ).toBe(0);
  });
  it('keeps bank/MoMo pending until evidence; exclusive payout claim never credits a wallet', async () => {
    const created = await order('MOMO');
    // This case represents an order created before the stricter admin cedi workflow.
    await prisma.manualExchangeOrder.update({
      where: { id: created.id },
      data: { payoutWorkflow: 'LEGACY' },
    });
    await attach(created.id);
    const deposit = await service.review(
      created.id,
      admin(),
      { ...confirm('DEP-' + randomUUID()), action: 'CONFIRM_DEPOSIT' },
      randomUUID(),
    );
    expect(deposit.status).toBe('PAYOUT_PENDING');
    const claimKey = randomUUID();
    await service.review(
      created.id,
      admin(),
      { action: 'CLAIM_PAYOUT', reason: 'Claiming this manual payout' },
      claimKey,
    );
    await expect(
      service.review(
        created.id,
        otherAdmin(),
        { action: 'CLAIM_PAYOUT', reason: 'Competing payout operator' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      service.review(
        created.id,
        admin(),
        { action: 'COMPLETE', reason: 'Premature completion attempt' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const upload = await service.uploadUrl(
      created.id,
      admin(),
      {
        fileName: 'paid.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
      true,
    );
    objects.set(upload.objectKey, pdf);
    const sent = await service.review(
      created.id,
      admin(),
      {
        action: 'MARK_SENT',
        reason: 'Actual bank payment sent and referenced',
        payoutReference: 'OUT-' + randomUUID(),
        payoutProofObjectKey: upload.objectKey,
      },
      randomUUID(),
    );
    expect(sent.status).toBe('PAYOUT_SENT');
    const row = await prisma.manualExchangeOrder.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(
      (
        await prisma.transaction.findUniqueOrThrow({
          where: { id: row.transactionId },
        })
      ).status,
    ).toBe('PENDING');
    const complete = await service.review(
      created.id,
      otherAdmin(),
      { action: 'COMPLETE', reason: 'Settlement confirmed on bank statement' },
      randomUUID(),
    );
    expect(complete.status).toBe('COMPLETED');
    expect((await balance()).toFixed(2)).toBe('1000.00');
    expect(
      await prisma.ledgerEntry.count({
        where: { transactionId: row.transactionId },
      }),
    ).toBe(0);
  });
  it('rejects cross-user access, wrong received amount and forged proof contents', async () => {
    const created = await order();
    await expect(
      service.get(created.id, fixture.users.recipientA.id),
    ).rejects.toThrow('not found');
    const upload = await service.uploadUrl(
      created.id,
      user(),
      {
        fileName: 'fake.pdf',
        contentType: 'application/pdf',
        fileSize: pdf.length,
      },
      randomUUID(),
    );
    objects.set(upload.objectKey, Buffer.alloc(pdf.length));
    await expect(
      service.attach(
        created.id,
        user(),
        { objectKey: upload.objectKey, bankReference: 'TEST-1234' },
        randomUUID(),
      ),
    ).rejects.toThrow('file type');
    await attach(created.id);
    await expect(
      service.review(
        created.id,
        admin(),
        { ...confirm('DEP-' + randomUUID()), actualAmount: '99.00' },
        randomUUID(),
      ),
    ).rejects.toThrow('exact received amount');
    expect((await balance()).toFixed(2)).toBe('1000.00');
  });
});
