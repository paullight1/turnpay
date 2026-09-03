import { createHmac, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BankingService } from '../src/banking/banking.service';
import { ReconciliationService } from '../src/common/services/reconciliation.service';
import { WebhookController } from '../src/payments/webhooks/payment-webhook.controller';
import { PaymentWebhookProcessorService } from '../src/payments/webhooks/payment-webhook.processor';
import { WebhookInboxService } from '../src/payments/webhooks/webhook-inbox.service';
import { LedgerService } from '../src/wallets/ledger.service';
import { createFinancialTestPrisma } from './support/transfer-fixtures';

describe('Monnify webhook financial E2E (real PostgreSQL)', () => {
  const secret = randomUUID();
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const config = {
    get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'MONNIFY_SECRET_KEY') return secret;
      throw new Error(`Missing test configuration: ${key}`);
    }),
  };
  const paymentService = { processTransferWebhook: jest.fn() };
  const exchangeService = {
    processMonnifyExchangeDepositWebhook: jest
      .fn()
      .mockResolvedValue({ matched: false, processed: false }),
  };

  let prisma: PrismaClient;
  let fixture: Awaited<ReturnType<typeof createFixture>> | undefined;

  beforeAll(async () => {
    prisma = createFinancialTestPrisma();
    await prisma.$connect();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    exchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: false,
      processed: false,
    });
    fixture = await createFixture(prisma);
  });

  afterEach(async () => {
    if (fixture) {
      await cleanupFixture(prisma, fixture);
      fixture = undefined;
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it('rejects missing and invalid signatures without any financial mutation', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    const { controller, body, rawBody } = createServices(prisma, fixture);

    await expect(
      controller.handleMonnifyWebhook(
        undefined as unknown as string,
        { rawBody } as never,
        body,
      ),
    ).rejects.toThrow('Missing signature header');
    await expect(
      controller.handleMonnifyWebhook(
        '0'.repeat(128),
        { rawBody } as never,
        body,
      ),
    ).rejects.toThrow('Invalid signature');

    await expect(financialCounts(prisma, fixture)).resolves.toEqual({
      providerEvents: 0,
      inboxEvents: 0,
      transactions: 0,
      ledgerEntries: 0,
      audits: 0,
    });
    await expect(walletBalance(prisma, fixture)).resolves.toBe('0.00');
  });

  it('accepts a signed raw-byte fixture and applies concurrent duplicates exactly once', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    const first = createServices(prisma, fixture);
    const second = createServices(prisma, fixture);
    const signature = sign(first.rawBody);

    await Promise.all([
      first.controller.handleMonnifyWebhook(
        signature,
        { rawBody: first.rawBody } as never,
        first.body,
      ),
      second.controller.handleMonnifyWebhook(
        signature,
        { rawBody: first.rawBody } as never,
        first.body,
      ),
    ]);
    await Promise.all([
      first.processor.processDueEvents(),
      second.processor.processDueEvents(),
    ]);

    await expect(financialCounts(prisma, fixture)).resolves.toEqual({
      providerEvents: 1,
      inboxEvents: 1,
      transactions: 1,
      ledgerEntries: 1,
      audits: 1,
    });
    await expect(walletBalance(prisma, fixture)).resolves.toBe('25.00');
  });

  it('retries a processing failure and reports reconciliation drift without changing money', async () => {
    if (!fixture) throw new Error('Financial fixture was not created');
    await prisma.virtualAccount.update({
      where: { id: fixture.virtualAccountId },
      data: { currency: 'GHS' },
    });
    const services = createServices(prisma, fixture);
    await services.controller.handleMonnifyWebhook(
      sign(services.rawBody),
      { rawBody: services.rawBody } as never,
      services.body,
    );

    await services.processor.processDueEvents();
    await expect(walletBalance(prisma, fixture)).resolves.toBe('0.00');
    await expect(
      prisma.paymentWebhookInbox.findFirstOrThrow({
        where: { providerReference: fixture.providerReference },
        select: { status: true, attemptCount: true },
      }),
    ).resolves.toEqual({ status: 'FAILED', attemptCount: 1 });

    await prisma.virtualAccount.update({
      where: { id: fixture.virtualAccountId },
      data: { currency: 'NGN' },
    });
    await prisma.paymentWebhookInbox.updateMany({
      where: { providerReference: fixture.providerReference },
      data: { nextAttemptAt: new Date(0) },
    });
    await services.processor.processDueEvents();

    await expect(walletBalance(prisma, fixture)).resolves.toBe('25.00');
    await expect(financialCounts(prisma, fixture)).resolves.toEqual({
      providerEvents: 1,
      inboxEvents: 1,
      transactions: 1,
      ledgerEntries: 1,
      audits: 1,
    });

    await prisma.wallet.update({
      where: { id: fixture.walletId },
      data: { balance: { increment: new Decimal('1.00') } },
    });
    const reconciliation = new ReconciliationService(
      prisma as never,
      logger as never,
    );
    const beforeReconciliation = await walletBalance(prisma, fixture);
    const result = await reconciliation.reconcileWallets();

    expect(result.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletId: fixture.walletId,
          expectedBalance: '25.00',
          actualBalance: '26.00',
          difference: '1.00',
        }),
      ]),
    );
    await expect(walletBalance(prisma, fixture)).resolves.toBe(
      beforeReconciliation,
    );
  });

  function createServices(
    database: PrismaClient,
    currentFixture: NonNullable<typeof fixture>,
  ) {
    const inbox = new WebhookInboxService(database as never, logger as never);
    const banking = new BankingService(
      database as never,
      new LedgerService(database as never),
      {} as never,
      config as never,
      logger as never,
    );
    const controller = new WebhookController(
      paymentService as never,
      inbox,
      config as never,
      logger as never,
      database as never,
    );
    const processor = new PaymentWebhookProcessorService(
      inbox,
      paymentService as never,
      banking,
      exchangeService as never,
      database as never,
      logger as never,
    );
    const body = {
      eventType: 'SUCCESSFUL_TRANSACTION',
      eventData: {
        transactionReference: currentFixture.providerReference,
        paymentReference: `${currentFixture.providerReference}-PAYMENT`,
        paymentStatus: 'PAID',
        amountPaid: '25.00',
        settlementAmount: '24.50',
        currency: 'NGN',
        destinationAccountInformation: {
          accountNumber: currentFixture.accountNumber,
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    return { controller, processor, body, rawBody };
  }

  function sign(rawBody: Buffer) {
    return createHmac('sha512', secret).update(rawBody).digest('hex');
  }
});

async function createFixture(prisma: PrismaClient) {
  const id = randomUUID();
  const userId = `monnify-financial-${id}`;
  const walletId = `${userId}-wallet`;
  const virtualAccountId = `${userId}-account`;
  const providerReference = `MNF-FINANCIAL-${id}`;
  const accountNumber = id.replaceAll('-', '').slice(0, 10);

  await prisma.user.create({
    data: {
      id: userId,
      email: `${id}@monnify-financial.test`,
      phone: `+234${id.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`,
      fullName: 'Monnify Financial Fixture',
      password: randomUUID(),
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
    },
  });
  await prisma.wallet.create({
    data: { id: walletId, userId, currency: 'NGN', balance: new Decimal(0) },
  });
  await prisma.virtualAccount.create({
    data: {
      id: virtualAccountId,
      userId,
      provider: 'MONNIFY',
      providerAccountId: `${id}-provider-account`,
      accountNumber,
      accountNumberMasked: `******${accountNumber.slice(-4)}`,
      accountName: 'Monnify Financial Fixture',
      bankName: 'Sandbox Bank',
      currency: 'NGN',
      status: 'ACTIVE',
    },
  });

  return {
    userId,
    walletId,
    virtualAccountId,
    providerReference,
    accountNumber,
  };
}

async function cleanupFixture(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  await prisma.auditLog.deleteMany({
    where: { reference: fixture.providerReference },
  });
  await prisma.ledgerEntry.deleteMany({
    where: { walletId: fixture.walletId },
  });
  await prisma.transaction.deleteMany({ where: { userId: fixture.userId } });
  await prisma.paymentWebhookInbox.deleteMany({
    where: { providerReference: fixture.providerReference },
  });
  await prisma.webhookLog.deleteMany({
    where: { reference: fixture.providerReference },
  });
  await prisma.providerEvent.deleteMany({
    where: { providerReference: fixture.providerReference },
  });
  await prisma.virtualAccount.deleteMany({ where: { userId: fixture.userId } });
  await prisma.wallet.deleteMany({ where: { userId: fixture.userId } });
  await prisma.user.delete({ where: { id: fixture.userId } });
}

async function financialCounts(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const [providerEvents, inboxEvents, transactions, ledgerEntries, audits] =
    await Promise.all([
      prisma.providerEvent.count({
        where: { providerReference: fixture.providerReference },
      }),
      prisma.paymentWebhookInbox.count({
        where: { providerReference: fixture.providerReference },
      }),
      prisma.transaction.count({ where: { userId: fixture.userId } }),
      prisma.ledgerEntry.count({ where: { walletId: fixture.walletId } }),
      prisma.auditLog.count({
        where: { reference: fixture.providerReference },
      }),
    ]);
  return { providerEvents, inboxEvents, transactions, ledgerEntries, audits };
}

async function walletBalance(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { id: fixture.walletId },
    select: { balance: true },
  });
  return wallet.balance.toFixed(2);
}
