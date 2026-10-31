import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { WebhookController } from './payment-webhook.controller';

describe('Paystack webhook trust boundary', () => {
  const accept = jest
    .fn()
    .mockResolvedValue({ eventId: 'inbox', duplicate: false });
  const create = jest.fn().mockResolvedValue({});
  const controller = new WebhookController(
    {} as never,
    { accept } as never,
    new ConfigService({ PAYSTACK_SECRET_KEY: 'sk_test_fixture' }),
    { info: jest.fn(), warn: jest.fn() } as never,
    { webhookLog: { create } } as never,
  );
  const payload = {
    event: 'charge.success',
    data: {
      reference: 'fund_fixture',
      amount: 100,
      currency: 'NGN',
      authorization: { account_number: '0123456789' },
    },
  };
  beforeEach(() => jest.clearAllMocks());
  it('persists a signed event and strips payment credentials before storage', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha512', 'sk_test_fixture')
      .update(rawBody)
      .digest('hex');
    await expect(
      controller.handlePaystackWebhook(
        signature,
        { rawBody } as never,
        payload,
      ),
    ).resolves.toEqual({ received: true });
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'PAYSTACK',
        providerReference: 'fund_fixture',
        eventType: 'charge.success',
      }),
    );
    expect(JSON.stringify(accept.mock.calls[0][0].payload)).not.toContain(
      '0123456789',
    );
  });
  it('rejects tampering without accepting an inbox event', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    await expect(
      controller.handlePaystackWebhook(
        '0'.repeat(128),
        { rawBody } as never,
        payload,
      ),
    ).rejects.toThrow('Invalid signature');
    expect(accept).not.toHaveBeenCalled();
  });
});
