import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { KoraCollectionsService } from '../src/kora/kora-collections.service';
import { LedgerService } from '../src/wallets/ledger.service';
import {
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  cleanupFinancialTransferFixture,
  walletBalance,
} from './support/transfer-fixtures';

describe('Kora collection financial boundary', () => {
  let db: PrismaClient;
  let fixture: Awaited<ReturnType<typeof createFinancialTransferFixture>>;
  let service: KoraCollectionsService;
  let payment: Record<string, unknown>;
  beforeAll(async () => {
    db = createFinancialTestPrisma();
    await db.$connect();
  });
  beforeEach(async () => {
    fixture = await createFinancialTransferFixture(db, {
      createPolicies: false,
    });
    const accountRef = `ghs-${fixture.users.sender.id}`;
    await db.virtualAccount.create({
      data: {
        userId: fixture.users.sender.id,
        provider: 'KORA',
        currency: 'GHS',
        status: 'ACTIVE',
        providerAccountId: accountRef,
        accountNumber: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        accountNumberMasked: '***1234',
        accountName: 'Synthetic',
        bankName: 'Synthetic',
      },
    });
    const account = await db.virtualAccount.findFirstOrThrow({
      where: { userId: fixture.users.sender.id, provider: 'KORA' },
    });
    payment = {
      reference: `receipt-${fixture.users.sender.id}`,
      status: 'success',
      currency: 'GHS',
      amount: '10.01',
      amount_paid: '10.01',
      fee: '0.10',
      virtual_bank_account: {
        account_reference: accountRef,
        account_number: account.accountNumber,
      },
    };
    const client = {
      request: jest.fn().mockImplementation(async () => payment),
    };
    service = new KoraCollectionsService(
      db as never,
      client as never,
      new LedgerService(db as never),
      { get: () => ({ momoCollections: true, exchange: true }) } as never,
      new ConfigService({
        BANK_ACCOUNT_ENCRYPTION_KEY: 'synthetic-test-secret',
      }),
    );
  });
  afterEach(async () => {
    const userId = fixture.users.sender.id;
    await db.koraCollectionIntent.deleteMany({ where: { userId } });
    await db.virtualAccount.deleteMany({ where: { userId } });
    await db.providerEvent.deleteMany({
      where: { providerReference: { contains: fixture.fixtureId } },
    });
    await cleanupFinancialTransferFixture(db, fixture);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it('credits exactly once across concurrent provider retries and leaves NGN unchanged', async () => {
    const reference = String(payment.reference);
    const results = await Promise.allSettled([
      service.confirmCharge(reference),
      service.confirmCharge(reference),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    await service.confirmCharge(reference);
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('1010.01');
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'NGN')).toFixed(2),
    ).toBe('1000.00');
    expect(
      await db.ledgerEntry.count({ where: { reference: `KORA:${reference}` } }),
    ).toBe(1);
  });
  it('rejects a mismatched currency without moving any money', async () => {
    payment.currency = 'NGN';
    await expect(
      service.confirmCharge(String(payment.reference)),
    ).rejects.toThrow();
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('1000.00');
  });
  it('does not identify a customer by an email-only payment', async () => {
    delete payment.virtual_bank_account;
    payment.customer = { email: fixture.users.sender.email };
    await expect(
      service.confirmCharge(String(payment.reference)),
    ).rejects.toThrow();
    expect(
      (await walletBalance(db, fixture.users.sender.id, 'GHS')).toFixed(2),
    ).toBe('1000.00');
  });
});
