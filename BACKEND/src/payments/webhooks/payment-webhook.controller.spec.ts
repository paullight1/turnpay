import { createHmac } from 'crypto';
import { WebhookController } from './payment-webhook.controller';

describe('WebhookController', () => {
  const paymentService = {
    processTransferWebhook: jest.fn(),
  };

  const bankingService = {
    processVirtualAccountDeposit: jest.fn(),
  };

  const exchangeService = {
    processMonnifyExchangeDepositWebhook: jest.fn(),
  };

  const webhookInbox = {
    accept: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const prisma = {
    webhookLog: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const webhookBody = {
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      transactionReference: 'MNF-1',
      paymentReference: 'PY-1',
      amountPaid: 1500,
      currency: 'NGN',
      paymentStatus: 'PAID',
      destinationAccountInformation: {
        accountNumber: '0123456789',
      },
    },
  };

  const rawBody = JSON.stringify(webhookBody);
  const validSignature = createHmac('sha512', 'webhook-secret')
    .update(rawBody)
    .digest('hex');

  const request = { rawBody };

  let controller: WebhookController;

  beforeEach(() => {
    jest.clearAllMocks();

    configService.get.mockReturnValue(undefined);
    configService.getOrThrow.mockImplementation((key: string) => {
      if (key === 'MONNIFY_SECRET_KEY') return 'webhook-secret';
      return 'configured-secret';
    });
    controller = new WebhookController(
      paymentService as any,
      webhookInbox as any,
      configService as any,
      logger as any,
      prisma as any,
    );
    prisma.webhookLog.create.mockResolvedValue({ id: 'webhook-log-1' });
    prisma.webhookLog.update.mockResolvedValue({ id: 'webhook-log-1' });
    webhookInbox.accept.mockResolvedValue({
      eventId: 'evt-1',
      duplicate: false,
    });

    bankingService.processVirtualAccountDeposit.mockResolvedValue({
      received: true,
      processed: true,
    });
    exchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: false,
      processed: false,
    });
  });

  it('rejects Monnify webhooks without a signature', async () => {
    await expect(
      controller.handleMonnifyWebhook(
        undefined as unknown as string,
        request as any,
        webhookBody,
      ),
    ).rejects.toThrow('Missing signature header');
  });

  it('rejects Monnify webhooks with an invalid signature', async () => {
    await expect(
      controller.handleMonnifyWebhook('invalid', request as any, webhookBody),
    ).rejects.toThrow('Invalid signature');
  });

  it('accepts verified Monnify webhooks into the inbox and acknowledges immediately', async () => {
    const response = await controller.handleMonnifyWebhook(
      validSignature,
      request as any,
      webhookBody,
    );

    expect(response).toEqual({ received: true });
    expect(webhookInbox.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'MONNIFY',
        eventType: 'SUCCESSFUL_TRANSACTION',
        providerReference: 'MNF-1',
        payload: webhookBody,
      }),
    );
    expect(bankingService.processVirtualAccountDeposit).not.toHaveBeenCalled();
    expect(
      exchangeService.processMonnifyExchangeDepositWebhook,
    ).not.toHaveBeenCalled();
  });

  it('accepts documented Monnify fields and decimal strings', async () => {
    const extendedBody = {
      ...webhookBody,
      eventData: {
        ...webhookBody.eventData,
        amountPaid: '1500.00',
        totalPayable: '1500.00',
        paidOn: '2026-08-28T10:30:00Z',
        paymentMethod: 'ACCOUNT_TRANSFER',
        customer: { name: 'Test Customer', email: 'customer@example.com' },
        product: { type: 'RESERVED_ACCOUNT', reference: 'VA-1' },
      },
    };
    const extendedRawBody = JSON.stringify(extendedBody);
    const signature = createHmac('sha512', 'webhook-secret')
      .update(extendedRawBody)
      .digest('hex');

    await expect(
      controller.handleMonnifyWebhook(
        signature,
        { rawBody: extendedRawBody } as any,
        extendedBody,
      ),
    ).resolves.toEqual({ received: true });
  });

  it('rejects Monnify payloads that are missing the event type after signature verification', async () => {
    const invalidBody = {
      eventData: webhookBody.eventData,
    };
    const invalidRawBody = JSON.stringify(invalidBody);
    const invalidSignature = createHmac('sha512', 'webhook-secret')
      .update(invalidRawBody)
      .digest('hex');

    await expect(
      controller.handleMonnifyWebhook(
        invalidSignature,
        { rawBody: invalidRawBody } as any,
        invalidBody as any,
      ),
    ).rejects.toThrow('eventType must be a string');
  });

  it('rejects a signed Monnify envelope without eventData', async () => {
    const invalidBody = { eventType: 'SUCCESSFUL_TRANSACTION' };
    const invalidRawBody = JSON.stringify(invalidBody);
    const invalidSignature = createHmac('sha512', 'webhook-secret')
      .update(invalidRawBody)
      .digest('hex');

    await expect(
      controller.handleMonnifyWebhook(
        invalidSignature,
        { rawBody: invalidRawBody } as any,
        invalidBody,
      ),
    ).rejects.toThrow('eventData should not be null or undefined');
    expect(webhookInbox.accept).not.toHaveBeenCalled();
  });

  it('rejects Monnify event data without a provider reference', async () => {
    const invalidBody = {
      eventType: 'SUCCESSFUL_TRANSACTION',
      eventData: { paymentStatus: 'PAID', amountPaid: '1500.00' },
    };
    const invalidRawBody = JSON.stringify(invalidBody);
    const invalidSignature = createHmac('sha512', 'webhook-secret')
      .update(invalidRawBody)
      .digest('hex');

    await expect(
      controller.handleMonnifyWebhook(
        invalidSignature,
        { rawBody: invalidRawBody } as any,
        invalidBody,
      ),
    ).rejects.toThrow('Monnify provider reference is required');
    expect(webhookInbox.accept).not.toHaveBeenCalled();
  });

  it('uses a signed-body identity for refund events without a refund reference', async () => {
    const refundBody = {
      event: 'refund.processed',
      data: {
        transaction_reference: 'fund-reference-1',
        refund_reference: null,
        amount: '10000',
        currency: 'NGN',
        domain: 'test',
      },
    };
    const refundRawBody = JSON.stringify(refundBody);
    const refundSignature = createHmac('sha512', 'configured-secret')
      .update(refundRawBody)
      .digest('hex');

    await controller.handlePaystackWebhook(
      refundSignature,
      { rawBody: Buffer.from(refundRawBody) } as any,
      refundBody,
    );

    expect(webhookInbox.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'PAYSTACK',
        eventType: 'refund.processed',
        providerReference: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(webhookInbox.accept.mock.calls[0][0].providerReference).not.toBe(
      'fund-reference-1',
    );
  });
});
