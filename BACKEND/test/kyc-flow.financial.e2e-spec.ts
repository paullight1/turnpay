import { randomUUID, createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { PaystackKycRecoveryService } from '../src/kyc/paystack-kyc-recovery.service';
import { KycService } from '../src/kyc/kyc.service';
import { BankingService } from '../src/banking/banking.service';
import { AccountNotificationsService } from '../src/notifications/account-notifications.service';
import {
  TransactionalEmailOutboxService,
  EmailOutboxSettings,
} from '../src/notifications/email-outbox.service';
import { AdminKycController, KycController } from '../src/kyc/kyc.controller';
import { WebhookController } from '../src/payments/webhooks/payment-webhook.controller';
import { WebhookInboxService } from '../src/payments/webhooks/webhook-inbox.service';
import { PaymentWebhookProcessorService } from '../src/payments/webhooks/payment-webhook.processor';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { SupabaseService } from '../src/supabase/supabase.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentService } from '../src/payments/payment.service';
import { createFinancialTestPrisma } from './support/transfer-fixtures';

// Real PostgreSQL, Nest routes/guards/inbox/worker. Provider/auth/storage are
// explicit test boundaries; this does not certify a live Paystack delivery.
describe('KYC HTTP flow (isolated PostgreSQL)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;
  let service: KycService;
  let processor: PaymentWebhookProcessorService;
  let userId: string;
  let adminId: string;
  let customerCode: string;
  let bvnId: string;
  let fixture: string;
  const secret = randomUUID();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  };
  const paystack = { request: jest.fn(), page: jest.fn() };
  const config = {
    get: (key: string, fallback?: unknown) =>
      key === 'PII_ENCRYPTION_KEY'
        ? secret
        : key === 'PAYSTACK_DOMAIN'
          ? 'test'
          : fallback,
    getOrThrow: (key: string) => {
      if (key === 'PAYSTACK_SECRET_KEY') return secret;
      throw new Error('Unknown test configuration');
    },
  };
  const storage = {
    createSignedUploadUrl: jest.fn().mockResolvedValue({
      signedUrl: 'https://storage.test/upload',
      token: 'test-only',
    }),
    createSignedReadUrl: jest
      .fn()
      .mockResolvedValue('https://storage.test/private-evidence'),
    getAdminClient: () => ({
      storage: {
        from: () => ({
          info: async () => ({
            data: { size: 128, contentType: 'application/pdf' },
            error: null,
          }),
        }),
      },
    }),
    verifyToken: async (token: string) => {
      if (token === 'customer') return { id: userId };
      if (token === 'reviewer') return { id: adminId };
      throw new Error('Invalid test token');
    },
    getVerifiedProviderSessionId: async () => undefined,
  };

  beforeAll(async () => {
    prisma = createFinancialTestPrisma();
    await prisma.$connect();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    fixture = randomUUID();
    userId = randomUUID();
    adminId = randomUUID();
    bvnId = randomUUID();
    customerCode = `CUS_${fixture.replaceAll('-', '')}`;
    for (const [id, role, index] of [
      [userId, 'USER', 1],
      [adminId, 'ADMIN', 2],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@kyc.test`,
          phone: `+234${fixture.replace(/\D/g, '').padEnd(11, '0').slice(0, 10)}${index}`,
          password: 'test-noncredential',
          role,
          kycStatus: 'SUBMITTED',
          kycTier: 'TIER_0',
        },
      });
    }
    await prisma.kycDocument.create({
      data: { id: bvnId, userId, type: 'BVN', status: 'SUBMITTED' },
    });
    await prisma.paystackCustomer.create({
      data: {
        userId,
        customerCode,
        customerId: '1234',
        validationStatus: 'PENDING',
        validationFingerprint: fixture,
      },
    });
    await prisma.kycVerification.create({
      data: {
        userId,
        documentId: bvnId,
        provider: 'PAYSTACK',
        status: 'PENDING',
        reference: fixture,
        checks: {
          customerCode,
          validationFingerprint: fixture,
          accountSetupConsent: false,
        },
      },
    });
    service = new KycService(
      prisma as never,
      config as never,
      logger as never,
      storage as never,
      { provider: 'PAYSTACK' } as never,
      {} as never,
      undefined,
      new AccountNotificationsService(),
    );
    const inbox = new WebhookInboxService(prisma as never, logger as never);
    processor = new PaymentWebhookProcessorService(
      inbox,
      {} as never,
      {} as never,
      {} as never,
      prisma as never,
      logger as never,
      undefined,
      service,
    );
    const module = await Test.createTestingModule({
      controllers: [KycController, AdminKycController, WebhookController],
      providers: [
        JwtAuthGuard,
        RolesGuard,
        { provide: KycService, useValue: service },
        {
          provide: PaystackKycRecoveryService,
          useValue: new PaystackKycRecoveryService(
            prisma as never,
            paystack as never,
            config as never,
            logger as never,
          ),
        },
        { provide: WebhookInboxService, useValue: inbox },
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseService, useValue: storage },
        { provide: ConfigService, useValue: config },
        { provide: PinoLogger, useValue: logger },
        { provide: PaymentService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new IdempotencyInterceptor(
        { isAvailable: () => false, get: async () => null } as never,
        prisma as never,
        logger as never,
      ),
    );
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: { contains: adminId } },
    });
    await prisma.idempotencyRecord.deleteMany({
      where: { scope: { contains: userId } },
    });
    await prisma.paymentWebhookInbox.deleteMany({
      where: { providerReference: customerCode },
    });
    await prisma.webhookLog.deleteMany({ where: { reference: customerCode } });
    await prisma.paymentNotification.deleteMany({
      where: { audience: `USER:${userId}` },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { adminId },
          { targetId: bvnId },
          { reference: fixture },
          { metadata: { path: ['userId'], equals: userId } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
  });
  afterAll(async () => prisma?.$disconnect());

  async function deliver(
    event = 'customeridentification.success',
    valid = true,
  ) {
    const raw = JSON.stringify({
      event,
      data: { customer_code: customerCode, customer_id: 1234 },
    });
    return request(app.getHttpServer())
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set(
        'x-paystack-signature',
        valid
          ? createHmac('sha512', secret).update(raw).digest('hex')
          : '0'.repeat(128),
      )
      .send(raw);
  }
  async function submitNin(key = randomUUID()) {
    return request(app.getHttpServer())
      .post('/api/kyc/manual-documents')
      .set('Authorization', 'Bearer customer')
      .set('Idempotency-Key', key)
      .send({
        type: 'NIN',
        idNumber: '11111111111',
        objectKey: `kyc/${userId}/evidence.pdf`,
        consentAccepted: true,
      });
  }
  function review(
    id: string,
    status: string,
    key = randomUUID(),
    token = 'reviewer',
  ) {
    return request(app.getHttpServer())
      .put(`/api/admin/kyc/${id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({
        status,
        rejectionNote: 'Identity evidence checked against profile',
      });
  }

  it('reconciles an accepted check without events and keeps BVN pending with a stable support reference', async () => {
    paystack.request.mockResolvedValue({
      id: 1234,
      customer_code: customerCode,
      domain: 'test',
      identified: false,
    });
    paystack.page.mockResolvedValue({ data: [] });
    const reconcile = (key = randomUUID()) =>
      request(app.getHttpServer())
        .post('/api/kyc/paystack/reconcile')
        .set('Authorization', 'Bearer customer')
        .set('Idempotency-Key', key)
        .send({});
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/kyc/paystack/reconcile')
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/kyc/paystack/reconcile')
          .set('Authorization', 'Bearer customer')
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/kyc/paystack/reconcile')
          .set('Authorization', 'Bearer customer')
          .set('Idempotency-Key', randomUUID())
          .send({ customerCode: 'foreign' })
      ).status,
    ).toBe(400);
    const key = randomUUID();
    const first = await reconcile(key);
    expect(first.status).toBe(201);
    expect(first.body).toEqual(
      expect.objectContaining({
        state: 'AWAITING_PROVIDER',
        supportReference: 'KYC-' + bvnId,
        retryAllowed: false,
      }),
    );
    expect((await reconcile(key)).body).toEqual(first.body);
    await reconcile();
    expect(paystack.page).toHaveBeenCalledTimes(1);
    const overview = await request(app.getHttpServer())
      .get('/api/kyc/status')
      .set('Authorization', 'Bearer customer');
    expect(overview.body.documents[0].recovery.supportReference).toBe(
      first.body.supportReference,
    );
    expect(overview.body.documents[0].verificationStatus).toBe('PENDING');
    expect(overview.body.kycTier).toBe('TIER_0');
    expect(JSON.stringify(first.body)).not.toContain(customerCode);
  });

  it('reserves only one provider replay under concurrent HTTP requests and finalizes only through the signed inbox', async () => {
    paystack.page.mockResolvedValue({
      data: [
        {
          _id: 'event_123',
          domain: 'test',
          category: 'customers',
          category_row_id: 1234,
          event_name: 'customeridentification.success',
        },
      ],
    });
    paystack.request.mockImplementation(
      async (method: string, path: string) => {
        if (method === 'POST') return { count: 1, failed: 0, failed_ids: [] };
        if (path.startsWith('/customer/'))
          return {
            id: 1234,
            customer_code: customerCode,
            domain: 'test',
            identified: true,
          };
        return {
          _id: 'event_123',
          domain: 'test',
          category: 'customers',
          category_row_id: 1234,
          event_name: 'customeridentification.success',
          createdAt: new Date().toISOString(),
          event_payload: {
            event: 'customeridentification.success',
            data: { customer_code: customerCode, customer_id: 1234 },
          },
        };
      },
    );
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app.getHttpServer())
          .post('/api/kyc/paystack/reconcile')
          .set('Authorization', 'Bearer customer')
          .set('Idempotency-Key', randomUUID())
          .send({}),
      ),
    );
    expect(results.every((result) => result.status === 201)).toBe(true);
    expect(
      paystack.request.mock.calls.filter(([method]) => method === 'POST'),
    ).toHaveLength(1);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).kycTier,
    ).toBe('TIER_0');
    expect((await deliver()).status).toBe(200);
    await processor.processDueEvents();
    const overview = await request(app.getHttpServer())
      .get('/api/kyc/status')
      .set('Authorization', 'Bearer customer');
    expect(overview.body.documents[0].verificationStatus).toBe('VERIFIED');
    expect(overview.body.documents[0]).not.toHaveProperty('recovery');
    expect(overview.body.kycTier).toBe('TIER_1');
  });

  it('rejects unsigned events, accepts a signed BVN result exactly once, and preserves terminal state', async () => {
    expect(
      (await deliver('customeridentification.success', false)).status,
    ).toBe(400);
    expect(
      await prisma.paymentWebhookInbox.count({
        where: { providerReference: customerCode },
      }),
    ).toBe(0);
    expect((await deliver()).status).toBe(200);
    expect((await deliver()).status).toBe(200);
    await processor.processDueEvents();
    expect(
      await prisma.user.findUnique({
        where: { id: userId },
        select: { kycTier: true },
      }),
    ).toEqual({ kycTier: 'TIER_1' });
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'PAYSTACK_CUSTOMER_IDENTIFICATION_RESULT',
          targetId: (
            await prisma.kycVerification.findFirstOrThrow({
              where: { reference: fixture },
            })
          ).id,
        },
      }),
    ).toBe(1);
    expect((await deliver('customeridentification.failed')).status).toBe(200);
    await processor.processDueEvents();
    expect(
      (await service.getUserKycStatus(userId)).providerValidationStatus,
    ).toBe('VERIFIED');
    expect((await review(bvnId, 'VERIFIED')).status).toBe(400);
    expect(
      await prisma.emailOutbox.count({
        where: { userId, eventType: 'BVN_VERIFIED' },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentNotification.count({
        where: { audience: `USER:${userId}` },
      }),
    ).toBe(1);
  });

  it('rolls back verification with a failed outbox write, then confirms and queues once on retry', async () => {
    const failing = prisma.$extends({
      query: {
        emailOutbox: {
          createMany: async () => {
            throw new Error('Synthetic mail persistence failure');
          },
        },
      },
    });
    const failedService = new KycService(
      failing as never,
      config as never,
      logger as never,
      storage as never,
      { provider: 'PAYSTACK' } as never,
      {} as never,
      undefined,
      new AccountNotificationsService(),
    );
    const data = { customer_code: customerCode, customer_id: 1234 };
    await expect(
      failedService.processPaystackIdentification(
        'customeridentification.success',
        data,
      ),
    ).rejects.toThrow('Synthetic mail persistence failure');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).kycTier,
    ).toBe('TIER_0');
    expect(
      (await prisma.kycDocument.findUniqueOrThrow({ where: { id: bvnId } }))
        .status,
    ).toBe('SUBMITTED');
    expect(
      await prisma.paymentNotification.count({
        where: { audience: `USER:${userId}` },
      }),
    ).toBe(0);
    await service.processPaystackIdentification(
      'customeridentification.success',
      data,
    );
    await service.processPaystackIdentification(
      'customeridentification.success',
      data,
    );
    expect(await prisma.emailOutbox.count({ where: { userId } })).toBe(1);
  });

  it('lets concurrent mail workers claim a confirmed BVN event only once', async () => {
    await service.processPaystackIdentification(
      'customeridentification.success',
      { customer_code: customerCode, customer_id: 1234 },
    );
    const send = jest.fn().mockResolvedValue({
      status: 'SENT',
      providerMessageId: 'synthetic-delivery',
    });
    const settings: EmailOutboxSettings = {
      provider: 'resend',
      enabled: true,
      from: 'Sender <sender@example.com>',
      batchSize: 2,
      leaseSeconds: 300,
      retryBaseSeconds: 1,
      maxAttempts: 3,
    };
    const worker = () =>
      new TransactionalEmailOutboxService(
        prisma as never,
        settings,
        { send },
        logger as never,
        { verify: async () => ({ verified: true as const }) },
      );
    await Promise.all([
      worker().dispatchPendingEmails(),
      worker().dispatchPendingEmails(),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await prisma.emailOutbox.count({ where: { userId, status: 'SENT' } }),
    ).toBe(1);
    await worker().dispatchPendingEmails();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps transactional mail events private even if a Data API role gains a table grant', async () => {
    await service.processPaystackIdentification(
      'customeridentification.success',
      { customer_code: customerCode, customer_id: 1234 },
    );
    const flags = await prisma.$queryRaw<
      Array<{ relrowsecurity: boolean }>
    >`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_outbox'::regclass`;
    expect(flags).toEqual([{ relrowsecurity: true }]);
    const rollback = new Error('Rollback test-only grant');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('GRANT SELECT ON email_outbox TO anon');
        await tx.$executeRawUnsafe('SET LOCAL ROLE anon');
        expect(await tx.emailOutbox.findMany()).toEqual([]);
        await tx.$executeRawUnsafe('RESET ROLE');
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('persists a ready account and its notice together, then reuses it without another provider request', async () => {
    await service.processPaystackIdentification(
      'customeridentification.success',
      { customer_code: customerCode, customer_id: 1234 },
    );
    await prisma.user.update({
      where: { id: userId },
      data: { fullName: 'Test Customer' },
    });
    await prisma.paystackAccountRequest.create({
      data: {
        userId,
        customerCode,
        status: 'PENDING',
        consentRecordedAt: new Date(),
      },
    });
    const provider = {
      configured: true,
      provisionVirtualAccount: jest.fn().mockResolvedValue({
        provider: 'paystack',
        providerAccountId: fixture,
        providerCustomerId: customerCode,
        accountNumber: fixture.replace(/\D/g, '').padEnd(10, '0').slice(0, 10),
        accountName: 'Test Customer',
        bankName: 'Synthetic Bank',
        currency: 'NGN',
        status: 'ACTIVE',
      }),
    };
    const bankingConfig = new ConfigService({
      BANKING_ENABLED: true,
      VIRTUAL_ACCOUNTS_ENABLED: true,
      BANKING_PROVIDER_PRIMARY: 'paystack',
    });
    const failing = prisma.$extends({
      query: {
        emailOutbox: {
          async createMany({ args, query }) {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            if (rows.some((r) => r.eventType === 'ACCOUNT_READY'))
              throw new Error('Synthetic account notice failure');
            return query(args);
          },
        },
      },
    });
    const bank = (db: unknown) =>
      new BankingService(
        db as never,
        {} as never,
        {} as never,
        bankingConfig,
        logger as never,
        provider as never,
        undefined,
        new AccountNotificationsService(),
      );
    const input = {
      currency: 'NGN' as const,
      provider: 'paystack' as const,
      consentAccepted: true as const,
    };
    await expect(
      bank(failing).provisionVirtualAccount(userId, input),
    ).rejects.toThrow('Synthetic account notice failure');
    expect(await prisma.virtualAccount.count({ where: { userId } })).toBe(0);
    expect(
      (
        await prisma.paystackAccountRequest.findUniqueOrThrow({
          where: { userId },
        })
      ).status,
    ).toBe('PENDING');
    const account = await bank(prisma).provisionVirtualAccount(userId, input);
    const calls = provider.provisionVirtualAccount.mock.calls.length;
    const replay = await bank(prisma).provisionVirtualAccount(userId, input);
    if (!('id' in account) || !('id' in replay))
      throw new Error('Expected an active account');
    expect(replay.id).toBe(account.id);
    expect(provider.provisionVirtualAccount).toHaveBeenCalledTimes(calls);
    expect(
      await prisma.emailOutbox.count({
        where: { userId, eventType: 'ACCOUNT_READY' },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentNotification.count({
        where: { eventKey: `banking:account-ready:${account.id}` },
      }),
    ).toBe(1);
  });

  it('submits NIN while BVN is pending, enforces admin access, and reaches tier 2 only after both checks', async () => {
    const key = randomUUID();
    const created = await submitNin(key);
    expect(created.status).toBe(201);
    const repeated = await submitNin(key);
    expect(repeated.body.id).toBe(created.body.id);
    const ninId = created.body.id;
    expect(
      (await review(ninId, 'VERIFIED', randomUUID(), 'customer')).status,
    ).toBe(403);
    const decisionKey = randomUUID();
    const approved = await review(ninId, 'VERIFIED', decisionKey);
    expect(approved.status).toBe(200);
    expect((await review(ninId, 'VERIFIED', decisionKey)).body).toEqual(
      approved.body,
    );
    // An NIN review alone cannot newly activate BVN-first Tier 1.
    expect((await service.getUserKycStatus(userId)).kycTier).toBe('TIER_0');
    expect((await deliver()).status).toBe(200);
    await processor.processDueEvents();
    const overview = await service.getUserKycStatus(userId);
    expect(overview.kycTier).toBe('TIER_2');
    expect(overview.documents.every((d) => d.status === 'VERIFIED')).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: 'KYC_REVIEW', targetId: ninId },
      }),
    ).toBe(1);
  });

  it('allows exactly one decision when approve and reject race with different idempotency keys', async () => {
    const created = await submitNin();
    expect(created.status).toBe(201);
    const results = await Promise.all([
      review(created.body.id, 'VERIFIED'),
      review(created.body.id, 'REJECTED'),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'KYC_REVIEW', targetId: created.body.id },
      }),
    ).toBe(1);
  });

  it('preserves both verified checks when the provider result and manual approval arrive together', async () => {
    const created = await submitNin();
    expect(created.status).toBe(201);
    expect((await deliver()).status).toBe(200);
    const [, approval] = await Promise.all([
      processor.processDueEvents(),
      review(created.body.id, 'VERIFIED'),
    ]);
    expect(approval.status).toBe(200);
    expect((await service.getUserKycStatus(userId)).kycTier).toBe('TIER_2');
  });

  it('protects private evidence and requires validated, idempotent review requests', async () => {
    const created = await submitNin();
    expect(created.status).toBe(201);
    const path = `/api/admin/kyc/${created.body.id}/document-url`;
    expect(
      (await request(app.getHttpServer()).get('/api/admin/kyc/pending')).status,
    ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .post(path)
          .set('Authorization', 'Bearer customer')
          .set('Idempotency-Key', randomUUID())
          .send({})
      ).status,
    ).toBe(403);
    const evidence = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', 'Bearer reviewer')
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(evidence.status).toBe(201);
    expect(evidence.body.expiresInSeconds).toBe(300);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'KYC_DOCUMENT_ACCESS',
          targetId: created.body.id,
          adminId,
        },
      }),
    ).toBe(1);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/api/admin/kyc/${created.body.id}/review`)
          .set('Authorization', 'Bearer reviewer')
          .send({ status: 'VERIFIED', rejectionNote: 'Evidence checked' })
      ).status,
    ).toBe(400);
    expect((await review(created.body.id, 'APPROVED')).status).toBe(400);
    expect(JSON.stringify(created.body)).not.toContain('11111111111');
    expect((await service.getUserKycStatus(userId)).kycTier).toBe('TIER_0');
  });

  it('lists NIN for staff review and preserves rejection history when corrected evidence is submitted', async () => {
    const first = await submitNin();
    expect(first.status).toBe(201);
    const queue = await request(app.getHttpServer())
      .get('/api/admin/kyc/pending')
      .set('Authorization', 'Bearer reviewer');
    expect(queue.status).toBe(200);
    const item = queue.body.documents.find(
      (document: { id: string }) => document.id === first.body.id,
    );
    expect(item).toEqual(
      expect.objectContaining({
        type: 'NIN',
        manualReviewRequired: true,
        reviewSource: 'DOCUMENT',
        verificationStatus: 'REVIEW_REQUIRED',
      }),
    );
    expect(item).not.toHaveProperty('documentUrl');
    expect((await review(first.body.id, 'REJECTED')).status).toBe(200);
    const corrected = await submitNin();
    expect(corrected.status).toBe(201);
    expect(corrected.body.id).not.toBe(first.body.id);
    const overview = await request(app.getHttpServer())
      .get('/api/kyc/status')
      .set('Authorization', 'Bearer customer');
    const nin = overview.body.documents.filter(
      (document: { type: string }) => document.type === 'NIN',
    );
    expect(nin).toHaveLength(2);
    expect(nin.map((document: { status: string }) => document.status)).toEqual([
      'SUBMITTED',
      'REJECTED',
    ]);
    expect(nin[1].rejectionNote).toBe(
      'Identity evidence checked against profile',
    );
    expect(overview.body.kycTier).toBe('TIER_0');
  });

  it('serializes concurrent NIN submissions and keeps one pending review', async () => {
    const results = await Promise.all([submitNin(), submitNin()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.kycDocument.count({ where: { userId, type: 'NIN' } }),
    ).toBe(1);
  });
});
