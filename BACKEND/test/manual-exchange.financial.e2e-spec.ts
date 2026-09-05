import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { ManualExchangeService } from '../src/exchange/manual-exchange.service';
import { allocateDepositReference } from '../src/common/services/deposit-allocation';
import { Decimal } from '@prisma/client/runtime/library';
import { ManualExchangeReconciliationService } from '../src/exchange/manual-exchange-reconciliation.service';
import { LedgerService } from '../src/wallets/ledger.service';
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
  const makeService = (ledger?: LedgerService) =>
    new ManualExchangeService(
      prisma as PrismaService,
      config,
      {
        getRate: jest
          .fn()
          .mockResolvedValue({ rate: 0.02, markup: 0, isStale: false }),
      } as unknown as RateService,
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
  async function order(mode: SettlementMode = 'WALLET', key = randomUUID()) {
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

  it('freezes GHS collection and credits NGN exactly once for reverse exchange', async () => {
    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId_currency: { userId: user(), currency: 'NGN' } } });
    const key = randomUUID();
    const created = await service.create(user(), { sourceCurrency: 'GHS', amount: '100.00', settlementMode: 'WALLET', transactionPin: '2468' }, key);
    expect(created.sourceCurrency).toBe('GHS');
    expect(created.targetCurrency).toBe('NGN');
    expect(created.collectionAccount).toMatchObject({ currency: 'GHS', bankName: 'Test MoMo' });
    await expect(service.create(user(), { amount: '100.00', settlementMode: 'WALLET', transactionPin: '2468' }, key)).rejects.toThrow('different exchange details');
    await attach(created.id);
    const reviewKey = randomUUID();
    const review = confirm('GHS-DEP-' + randomUUID());
    await service.review(created.id, admin(), review, reviewKey);
    await service.review(created.id, admin(), review, reviewKey);
    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId_currency: { userId: user(), currency: 'NGN' } } });
    expect(after.balance.minus(before.balance).toFixed(2)).toBe(created.targetAmount);
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
  it('rejects existing wallet funding and provider-event references, and requires the destination wallet before instructions', async () => {
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
      where: { userId_currency: { userId: user(), currency: 'GHS' } },
    });
    await expect(order()).rejects.toThrow('Set up your GHS wallet');
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
  it('creates once across concurrent retry; retains instructions, exact amounts and immutable mode', async () => {
    const key = randomUUID();
    const results = await Promise.all([
      order('WALLET', key),
      order('WALLET', key),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results[0].targetAmount).toBe('2.00');
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
  it('keeps bank/MoMo pending until evidence; exclusive payout claim never credits a wallet', async () => {
    const created = await order('MOMO');
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
