import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import {
  ManualExchangeController,
  AdminManualExchangeController,
} from './manual-exchange.controller';
import { ManualExchangeService } from './manual-exchange.service';
import { ManualExchangeReconciliationService } from './manual-exchange-reconciliation.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PrismaService } from '../prisma/prisma.service';

describe('manual exchange HTTP authorization and validation', () => {
  let app: INestApplication;
  let role = 'USER';
  const service = {
    list: jest.fn().mockResolvedValue([]),
    queue: jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null, counts: {} }),
    create: jest.fn().mockResolvedValue({ id: 'order' }),
    review: jest.fn(),
    uploadHandoverUrl: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ManualExchangeController, AdminManualExchangeController],
      providers: [
        { provide: ManualExchangeService, useValue: service },
        { provide: ManualExchangeReconciliationService, useValue: {} },
        { provide: ConfigService, useValue: new ConfigService() },
        {
          provide: SupabaseService,
          useValue: {
            verifyToken: jest.fn().mockResolvedValue({}),
            getVerifiedProviderSessionId: jest
              .fn()
              .mockResolvedValue('provider-session-1'),
            syncUser: jest
              .fn()
              .mockResolvedValue({ id: 'customer', role: 'USER' }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn().mockImplementation(() =>
                Promise.resolve({
                  id: 'customer',
                  role,
                  email: 'synthetic@example.invalid',
                  isSuspended: false,
                }),
              ),
            },
            refreshToken: {
              findFirst: jest.fn().mockResolvedValue({ id: 'session-1' }),
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    role = 'USER';
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects missing authentication and prevents a customer reaching the admin queue', async () => {
    await request(app.getHttpServer())
      .get('/api/exchange/manual-orders')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/exchange/manual-orders')
      .set('Authorization', 'Bearer synthetic')
      .expect(403);
    expect(service.list).not.toHaveBeenCalled();
    role = 'ADMIN';
    await request(app.getHttpServer())
      .get('/api/admin/exchange/manual-orders')
      .set('Authorization', 'Bearer synthetic')
      .expect(200);
  });
  it('protects and validates the paginated admin queue', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/exchange/manual-orders/queue')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/exchange/manual-orders/queue')
      .set('Authorization', 'Bearer synthetic')
      .expect(403);
    role = 'ADMIN';
    await request(app.getHttpServer())
      .get('/api/admin/exchange/manual-orders/queue?cursor=invalid')
      .set('Authorization', 'Bearer synthetic')
      .expect(400);
    expect(service.queue).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get('/api/admin/exchange/manual-orders/queue?status=PAYOUT_PENDING')
      .set('Authorization', 'Bearer synthetic')
      .expect(200);
    expect(service.queue).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAYOUT_PENDING' }),
    );
  });
  it('rejects malformed amounts, missing external destination and injected settlement status before service execution', async () => {
    for (const body of [
      { amount: 'NaN', settlementMode: 'WALLET', transactionPin: '2468' },
      { amount: '100.00', settlementMode: 'MOMO', transactionPin: '2468' },
      {
        amount: '100.00',
        settlementMode: 'WALLET',
        transactionPin: '2468',
        status: 'CREDITED',
      },
    ])
      await request(app.getHttpServer())
        .post('/api/exchange/manual-orders')
        .set('Authorization', 'Bearer synthetic')
        .set('Idempotency-Key', 'synthetic-attempt-1234')
        .send(body)
        .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });
  it('rejects nonboolean expired-quote acknowledgement', async () => {
    role = 'ADMIN';
    await request(app.getHttpServer())
      .post(
        '/api/admin/exchange/manual-orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review',
      )
      .set('Authorization', 'Bearer synthetic')
      .send({
        action: 'CREDIT_WALLET',
        reason: 'Verified bank inflow',
        acceptExpiredQuote: 'true',
      })
      .expect(400);
    expect(service.review).not.toHaveBeenCalled();
  });
  it('requires a target administrator and an outcome classification for payout handover', async () => {
    role = 'ADMIN';
    await request(app.getHttpServer())
      .post(
        '/api/admin/exchange/manual-orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review',
      )
      .set('Authorization', 'Bearer synthetic')
      .set('Idempotency-Key', 'synthetic-handover-key')
      .send({
        action: 'HANDOVER_PAYOUT',
        reason: 'Supervisor checked the external payout outcome',
      })
      .expect(400);
    expect(service.review).not.toHaveBeenCalled();
  });
});
