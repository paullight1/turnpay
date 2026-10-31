import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { KoraWebhookController } from './kora-webhook.controller';

describe('Kora webhook ingress', () => {
  const secret = 'sk_test_synthetic';
  const data = { reference: 'KPY-synthetic', currency: 'GHS', amount: '10.00' };
  const signature = createHmac('sha256', secret)
    .update(JSON.stringify(data))
    .digest('hex');
  it('rejects forged events without accepting them into the inbox', async () => {
    const inbox = { accept: jest.fn() };
    const controller = new KoraWebhookController(
      new ConfigService({ KORA_SECRET_KEY: secret }),
      inbox as never,
    );
    await expect(
      controller.receive('bad', { event: 'charge.success', data }),
    ).rejects.toThrow();
    expect(inbox.accept).not.toHaveBeenCalled();
  });
  it('durably accepts a valid event without retaining account payloads', async () => {
    const inbox = { accept: jest.fn().mockResolvedValue({ eventId: 'event' }) };
    const controller = new KoraWebhookController(
      new ConfigService({ KORA_SECRET_KEY: secret }),
      inbox as never,
    );
    await expect(
      controller.receive(signature, { event: 'charge.success', data }),
    ).resolves.toEqual({ received: true });
    expect(inbox.accept).toHaveBeenCalledWith({
      provider: 'KORA',
      eventType: 'charge.success',
      providerReference: 'KPY-synthetic',
      payload: {
        event: 'charge.success',
        data: { reference: 'KPY-synthetic' },
      },
    });
  });
  it('does not acknowledge an event if durable storage fails', async () => {
    const controller = new KoraWebhookController(
      new ConfigService({ KORA_SECRET_KEY: secret }),
      {
        accept: jest.fn().mockRejectedValue(new Error('storage unavailable')),
      } as never,
    );
    await expect(
      controller.receive(signature, { event: 'charge.success', data }),
    ).rejects.toThrow('storage unavailable');
  });
});
