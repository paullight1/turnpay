import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { PaystackTransferApprovalController } from './paystack-transfer-approval.controller';
import { PaystackTransferApprovalService } from './paystack-transfer-approval.service';

describe('Transfer approval HTTP contract', () => {
  let app: INestApplication;
  const payload = {
    reference: 'wd_12345678901234567890',
    amount: 5000,
    currency: 'NGN',
    source: 'balance',
    recipient: 'RCP_target',
  };
  let approval: PaystackTransferApprovalService;
  beforeAll(async () => {
    const attempt = {
      id: 'attempt',
      transactionId: 'tx',
      provider: 'PAYSTACK',
      status: 'PENDING',
      providerStatus: 'RESERVED',
      metadata: {},
      transaction: {
        id: 'tx',
        reference: payload.reference,
        type: 'WITHDRAW',
        status: 'PENDING',
        amount: new Decimal(50),
        currency: 'NGN',
        userId: 'u',
        walletId: 'w',
        user: { kycStatus: 'VERIFIED', kycTier: 'TIER_1', isSuspended: false },
      },
    };
    const db = {
      $queryRaw: jest.fn(),
      transferAttempt: {
        findUnique: jest.fn(async () => attempt),
        update: jest.fn(async ({ data }) => Object.assign(attempt, data)),
      },
      ledgerEntry: {
        findMany: jest.fn(async () => [
          {
            source: 'WITHDRAWAL',
            direction: 'DEBIT',
            amount: new Decimal(50),
            walletId: 'w',
            currency: 'NGN',
          },
        ]),
      },
      auditLog: { create: jest.fn() },
    };
    approval = new PaystackTransferApprovalService(
      {
        $transaction: async (fn: (client: typeof db) => Promise<void>) =>
          fn(db),
      } as never,
      new ConfigService({
        PAYSTACK_TRANSFER_APPROVAL_ENABLED: true,
        WITHDRAWALS_ENABLED: true,
        PAYSTACK_SECRET_KEY: 'sk_test_http_fixture',
      }),
      { assertOutboundAllowed: jest.fn() } as never,
    );
    const module = await Test.createTestingModule({
      controllers: [PaystackTransferApprovalController],
      providers: [
        { provide: PaystackTransferApprovalService, useValue: approval },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    await approval.prepare(payload);
  });
  afterAll(async () => app.close());
  it('answers 200 for an exact persisted instruction without a user JWT or merchant OTP', async () => {
    await request(app.getHttpServer())
      .post('/api/webhooks/paystack/transfer-approval')
      .send({ ...payload, reason: 'TRUSTPAY withdrawal' })
      .expect(200, { approved: true });
  });
  it.each([
    { ...payload, amount: 5001 },
    { ...payload, recipient: 'RCP_other' },
    { ...payload, amount: '5000' },
    {},
    [],
  ])('answers 400 for a changed or invalid instruction', async (body) => {
    await request(app.getHttpServer())
      .post('/api/webhooks/paystack/transfer-approval')
      .send(body)
      .expect(400);
  });
});
