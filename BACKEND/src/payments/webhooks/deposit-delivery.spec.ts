import { PaymentWebhookProcessorService } from './payment-webhook.processor';
import { renderAccountEmail } from '../../notifications/email-outbox.service';
import { WebhookController } from './payment-webhook.controller';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

describe('prompt deposit delivery', () => {
  it('acknowledges durable acceptance before processing and wakes the worker without waiting for cron', async () => {
    let completed = false;
    let persisted = false;
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    const inbox = {
      accept: async () => {
        persisted = true;
        return { eventId: 'event', duplicate: false };
      },
      findDueEvents: async () =>
        persisted
          ? [{ id: 'event', provider: 'UNSUPPORTED', payload: {} }]
          : [],
      claim: async () => true,
      complete: async () => {
        completed = true;
      },
    };
    const prisma = {
      webhookLog: {
        create: async () => ({}),
        updateMany: async () => ({ count: 1 }),
      },
    };
    const worker = new PaymentWebhookProcessorService(
      inbox as never,
      {} as never,
      {} as never,
      {} as never,
      prisma as never,
      logger as never,
    );
    const controller = new WebhookController(
      {} as never,
      inbox as never,
      new ConfigService({ PAYSTACK_SECRET_KEY: 'sk_test_delivery_fixture' }),
      logger as never,
      prisma as never,
      worker,
    );
    const payload = {
      event: 'charge.success',
      data: { reference: 'deposit-fixture' },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha512', 'sk_test_delivery_fixture')
      .update(rawBody)
      .digest('hex');
    await expect(
      controller.handlePaystackWebhook(
        signature,
        { rawBody } as never,
        payload,
      ),
    ).resolves.toEqual({ received: true });
    expect(persisted).toBe(true);
    expect(completed).toBe(false);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(true);
  });

  it('coalesces overlapping worker runs rather than multiplying provider work', async () => {
    let release!: (rows: never[]) => void;
    const pending = new Promise<never[]>((resolve) => {
      release = resolve;
    });
    const inbox = { findDueEvents: jest.fn().mockReturnValue(pending) };
    const processor = new PaymentWebhookProcessorService(
      inbox as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { error: jest.fn() } as never,
    );
    const first = processor.processDueEvents();
    const second = processor.processDueEvents();
    release([]);
    await Promise.all([first, second]);
    expect(inbox.findDueEvents).toHaveBeenCalledTimes(1);
  });

  it('renders a TrustPay deposit confirmation without provider branding or sensitive details', () => {
    const email = renderAccountEmail('DEPOSIT_RECEIVED');
    expect(email).toEqual(
      expect.objectContaining({
        subject: expect.stringContaining('TrustPay'),
        text: expect.stringContaining('credited'),
        html: expect.stringContaining('TrustPay'),
      }),
    );
    expect(JSON.stringify(email)).not.toMatch(
      /paystack|account number|BVN|NIN/i,
    );
  });
});
