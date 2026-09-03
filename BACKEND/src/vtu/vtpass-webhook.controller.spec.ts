import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { VtpassWebhookController } from './vtpass-webhook.controller';

describe('VtpassWebhookController', () => {
  const inbox = {
    record: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let controller: VtpassWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockReturnValue(undefined);
    inbox.record.mockResolvedValue({
      duplicate: false,
      inboxId: 'inbox-1',
    });
    controller = new VtpassWebhookController(
      inbox as any,
      configService as any,
      logger as any,
    );
  });

  it('accepts a valid signed VTpass transaction update webhook', async () => {
    const secret = 'vtpass-webhook-test-secret';
    const body = {
      type: 'transaction-update' as const,
      data: {
        code: '000',
        requestId: 'REQ-1',
        response_description: 'TRANSACTION DELIVERED',
        content: {
          transactions: {
            status: 'delivered',
            transactionId: 'TX-1',
          },
        },
      },
    };
    const rawBody = JSON.stringify(body);
    const signature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    configService.get.mockReturnValue(secret);

    await expect(
      controller.handleVtpassWebhook(signature, { rawBody } as any, body),
    ).resolves.toEqual({ response: 'success' });

    expect(inbox.record).toHaveBeenCalledWith({
      eventType: 'transaction-update',
      providerRequestId: 'REQ-1',
      providerReference: 'TX-1',
      status: 'success',
      message: 'TRANSACTION DELIVERED',
      code: '000',
    });
  });

  it('rejects shared secret tokens in callback URLs', async () => {
    const secret = 'vtpass-dashboard-token';
    const body = {
      type: 'transaction-update' as const,
      data: {
        requestId: 'REQ-2',
        response_description: 'TRANSACTION REVERSAL TO WALLET',
        content: {
          transactions: {
            status: 'reversed',
            transactionId: 'TX-2',
          },
        },
      },
    };
    configService.get.mockReturnValue(secret);

    await expect(
      controller.handleVtpassWebhook(
        undefined,
        { rawBody: JSON.stringify(body) } as any,
        body,
      ),
    ).rejects.toThrow('Missing signature header');

    expect(inbox.record).not.toHaveBeenCalled();
  });

  it('rejects VTpass webhooks when the configured secret does not match', async () => {
    configService.get.mockReturnValue('vtpass-webhook-test-secret');

    await expect(
      controller.handleVtpassWebhook(
        'wrong-secret',
        { rawBody: '{}' } as any,
        {} as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(inbox.record).not.toHaveBeenCalled();
  });

  it('rejects VTpass webhooks when no webhook secret is configured', async () => {
    await expect(
      controller.handleVtpassWebhook(
        undefined,
        { rawBody: '{}' } as any,
        {} as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(inbox.record).not.toHaveBeenCalled();
  });

  it('rejects callbacks without a provider transaction id or known status', async () => {
    const secret = 'vtpass-webhook-test-secret';
    const body = {
      type: 'transaction-update' as const,
      data: { requestId: 'REQ-3', status: 'mystery' },
    };
    const rawBody = JSON.stringify(body);
    const signature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    configService.get.mockReturnValue(secret);

    await expect(
      controller.handleVtpassWebhook(
        signature,
        { rawBody } as any,
        body as any,
      ),
    ).rejects.toThrow('Invalid VTpass webhook payload');
    expect(inbox.record).not.toHaveBeenCalled();
  });
});
