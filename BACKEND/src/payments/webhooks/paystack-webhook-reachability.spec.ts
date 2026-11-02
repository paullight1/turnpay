import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { json } from 'body-parser';
import { createHmac } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../payment.service';
import { WebhookController } from './payment-webhook.controller';
import { WebhookInboxService } from './webhook-inbox.service';
import { captureWebhookRawBody } from '../../common/http/webhook-raw-body';

describe('Paystack webhook reachability over HTTP', () => {
  let app: INestApplication;
  const accept = jest
    .fn()
    .mockResolvedValue({ eventId: 'event', duplicate: false });
  const create = jest.fn().mockResolvedValue({});
  const secret = 'test-webhook-secret';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: PaymentService, useValue: {} },
        { provide: WebhookInboxService, useValue: { accept } },
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
        { provide: PinoLogger, useValue: { info: jest.fn(), warn: jest.fn() } },
        { provide: PrismaService, useValue: { webhookLog: { create } } },
      ],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    app.use(json({ verify: captureWebhookRawBodyForTest }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  it('answers browser GET and HEAD checks without accepting an event', async () => {
    await request(app.getHttpServer())
      .get('/api/webhooks/paystack')
      .expect(200)
      .expect({
        provider: 'paystack',
        deliveryMethod: 'POST',
        signatureRequired: true,
      });
    await request(app.getHttpServer())
      .head('/api/webhooks/paystack')
      .expect(200);
    expect(accept).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('continues rejecting unsigned and incorrectly signed POST requests', async () => {
    for (const signature of ['', 'invalid']) {
      await request(app.getHttpServer())
        .post('/api/webhooks/paystack')
        .set('x-paystack-signature', signature)
        .send({ event: 'customeridentification.success', data: {} })
        .expect(400);
    }
    expect(accept).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('validates the payload after checking the raw-body signature', async () => {
    const body = '{}';
    await request(app.getHttpServer())
      .post('/api/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set(
        'x-paystack-signature',
        createHmac('sha512', secret).update(body).digest('hex'),
      )
      .send(body)
      .expect(400)
      .expect(({ body: response }) =>
        expect(response.message).toBe('event must be a string'),
      );
    expect(accept).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

const captureWebhookRawBodyForTest: NonNullable<
  Parameters<typeof json>[0]
>['verify'] = (req, _res, body) => captureWebhookRawBody(req, body);
