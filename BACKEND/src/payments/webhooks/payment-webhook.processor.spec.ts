import { Decimal } from '@prisma/client/runtime/library';
import { PaymentWebhookProcessorService } from './payment-webhook.processor';

describe('PaymentWebhookProcessorService', () => {
  const inbox = {
    findDueEvents: jest.fn(),
    claim: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
    recoverStaleClaims: jest.fn(),
  };

  const paymentService = {
    processTransferWebhook: jest.fn(),
    processWebhookDeposit: jest.fn(),
  };

  const bankingService = {
    processVirtualAccountDeposit: jest.fn(),
  };

  const exchangeService = {
    processMonnifyExchangeDepositWebhook: jest.fn(),
  };

  const prisma = {
    webhookLog: {
      updateMany: jest.fn(),
    },
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  let service: PaymentWebhookProcessorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentWebhookProcessorService(
      inbox as any,
      paymentService as any,
      bankingService as any,
      exchangeService as any,
      prisma as any,
      logger as any,
    );
  });

  it('routes matched Monnify deposit events to exchange processing and completes the inbox event', async () => {
    inbox.findDueEvents.mockResolvedValue([
      {
        id: 'evt-1',
        provider: 'MONNIFY',
        eventType: 'SUCCESSFUL_TRANSACTION',
        providerReference: 'MNF-1',
        payload: {
          eventType: 'SUCCESSFUL_TRANSACTION',
          eventData: {
            transactionReference: 'MNF-1',
            paymentReference: 'PY-1',
            paymentStatus: 'PAID',
            amountPaid: 1500,
            currency: 'NGN',
            destinationAccountInformation: {
              accountNumber: '0123456789',
            },
          },
        },
      },
    ]);
    inbox.claim.mockResolvedValue(true);
    exchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: true,
      processed: true,
      receiptId: 'receipt-1',
    });

    await service.processDueEvents(10);

    expect(
      exchangeService.processMonnifyExchangeDepositWebhook,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: 'MNF-1',
        paymentReference: 'PY-1',
        accountNumber: '0123456789',
        currency: 'NGN',
      }),
    );
    const exchangeInput = exchangeService.processMonnifyExchangeDepositWebhook
      .mock.calls[0]?.[0] as {
      amount: Decimal;
    };
    expect(exchangeInput.amount.toString()).toBe('1500');
    expect(bankingService.processVirtualAccountDeposit).not.toHaveBeenCalled();
    expect(inbox.complete).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({
        routed: 'exchange',
      }),
    );
  });

  it('falls back to virtual-account processing when no exchange receipt matches', async () => {
    inbox.findDueEvents.mockResolvedValue([
      {
        id: 'evt-2',
        provider: 'MONNIFY',
        eventType: 'SUCCESSFUL_TRANSACTION',
        providerReference: 'MNF-2',
        payload: {
          eventType: 'SUCCESSFUL_TRANSACTION',
          eventData: {
            transactionReference: 'MNF-2',
            paymentStatus: 'PAID',
            amountPaid: 2000,
            settlementAmount: 1985,
            currency: 'NGN',
            destinationAccountInformation: {
              accountNumber: '0123456789',
            },
          },
        },
      },
    ]);
    inbox.claim.mockResolvedValue(true);
    exchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: false,
      processed: false,
    });
    bankingService.processVirtualAccountDeposit.mockResolvedValue({
      received: true,
      processed: true,
    });

    await service.processDueEvents(10);

    expect(bankingService.processVirtualAccountDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: 'MNF-2',
        settlementAmount: expect.any(Decimal),
      }),
    );
    const depositInput = bankingService.processVirtualAccountDeposit.mock
      .calls[0]?.[0] as {
      settlementAmount: Decimal;
    };
    expect(depositInput.settlementAmount.toString()).toBe('1985');
    expect(inbox.complete).toHaveBeenCalledWith(
      'evt-2',
      expect.objectContaining({
        routed: 'banking',
      }),
    );
  });

  it('records retry metadata when processing throws', async () => {
    inbox.findDueEvents.mockResolvedValue([
      {
        id: 'evt-3',
        provider: 'MONNIFY',
        eventType: 'SUCCESSFUL_TRANSACTION',
        providerReference: 'MNF-3',
        payload: {
          eventType: 'SUCCESSFUL_TRANSACTION',
          eventData: {
            transactionReference: 'MNF-3',
            paymentStatus: 'PAID',
            amountPaid: 2500,
            currency: 'NGN',
            destinationAccountInformation: {
              accountNumber: '0123456789',
            },
          },
        },
      },
    ]);
    inbox.claim.mockResolvedValue(true);
    exchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: false,
      processed: false,
    });
    bankingService.processVirtualAccountDeposit.mockRejectedValue(
      new Error('processor unavailable'),
    );

    await service.processDueEvents(10);

    expect(inbox.fail).toHaveBeenCalledWith(
      'evt-3',
      expect.stringContaining('processor unavailable'),
    );
    expect(prisma.webhookLog.updateMany).toHaveBeenCalledWith({
      where: { reference: 'MNF-3' },
      data: {
        errorMessage: 'processor unavailable',
      },
    });
  });
});
