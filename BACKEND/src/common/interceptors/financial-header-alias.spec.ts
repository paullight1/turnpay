import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PaymentController } from '../../payments/payment.controller';
import { PaymentService } from '../../payments/payment.service';
import { PaystackFundingService } from '../../payments/paystack-funding.service';
import { VtuController } from '../../vtu/vtu.controller';
import { VtuService } from '../../vtu/vtu.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { financialRequestIdentity } from '../utils/financial-request';

describe('financial route idempotency header aliases (HTTP)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentController, VtuController],
      providers: [
        {
          provide: PaymentService,
          useValue: {
            withdraw: async (
              userId: string,
              dto: Record<string, unknown>,
              key: string,
            ) => financialRequestIdentity('WITHDRAW', userId, key, dto),
          },
        },
        { provide: PaystackFundingService, useValue: {} },
        {
          provide: VtuService,
          useValue: {
            purchase: async (
              userId: string,
              dto: Record<string, unknown>,
              key: string,
            ) => financialRequestIdentity('VTU', userId, key, dto),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = {
            userId: 'synthetic-user',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it.each(['/api/payments/withdraw', '/api/vtu/purchase'])(
    'maps both accepted retry headers to the same operation on %s',
    async (path) => {
      const main = await request(app.getHttpServer())
        .post(path)
        .set('Idempotency-Key', 'original-key')
        .send({ amount: '100.00' })
        .expect(201);
      const alias = await request(app.getHttpServer())
        .post(path)
        .set('X-Idempotency-Key', 'original-key')
        .send({ amount: '100.00' })
        .expect(201);
      expect(alias.body.reference).toBe(main.body.reference);
    },
  );
});
