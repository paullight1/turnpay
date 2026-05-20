import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentService } from './payment.service';

describe('PaymentService deposits', () => {
  const prisma = {
    transaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    providerEvent: {
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const wallets = {};
  const users = {};
  const paystack = {
    verifyPayment: jest.fn(),
  };
  const flutterwave = {
    verifyPayment: jest.fn(),
  };
  const config = {
    get: jest.fn(),
    getOrThrow: jest.fn(() => 'secret'),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const http = {};
  const ledger = {
    creditWallet: jest.fn(),
    debitWallet: jest.fn(),
  };

  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.providerEvent.create.mockResolvedValue({
      id: 'provider-event-1',
      status: 'PROCESSING',
    });
    service = new PaymentService(
      prisma,
      wallets as any,
      users as any,
      paystack as any,
      flutterwave as any,
      config as any,
      logger as any,
      http as any,
      ledger as any,
    );
  });

  it('rejects payment verification for another user reference', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'owner-1',
      status: 'PENDING',
      metadata: { provider: 'paystack' },
    });

    await expect(
      service.verifyPayment('FUND-1', 'other-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(paystack.verifyPayment).not.toHaveBeenCalled();
  });

  it('does not credit webhook deposits when provider status is not successful', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      status: 'PENDING',
      amount: new Decimal(100),
      currency: 'NGN',
      reference: 'FUND-1',
    });

    const result = await service.processWebhookDeposit({
      reference: 'FUND-1',
      status: 'failed',
      amount: 100,
      currency: 'NGN',
    });

    expect(result).toEqual({ received: true, processed: false });
    expect(prisma.transaction.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUCCESS' } }),
    );
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('does not credit webhook deposits when currency mismatches the local transaction', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      status: 'PENDING',
      amount: new Decimal(100),
      currency: 'NGN',
      reference: 'FUND-1',
    });

    const result = await service.processWebhookDeposit({
      reference: 'FUND-1',
      status: 'success',
      amount: 100,
      currency: 'GHS',
    });

    expect(result).toEqual({ received: true, processed: false });
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('credits valid webhook deposits through the ledger exactly once', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      status: 'PENDING',
      amount: new Decimal(100),
      currency: 'NGN',
      reference: 'FUND-1',
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    ledger.creditWallet.mockResolvedValue({
      walletId: 'wallet-1',
      balanceAfter: new Decimal(1100),
    });

    const result = await service.processWebhookDeposit({
      reference: 'FUND-1',
      status: 'success',
      amount: 100,
      currency: 'NGN',
    });

    expect(result).toEqual({ received: true, processed: true });
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(100),
        transactionId: 'tx-1',
        reference: 'FUND-1',
        source: 'PAYMENT_DEPOSIT',
      }),
      prisma,
    );
    expect(prisma.providerEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'PAYSTACK',
        eventType: 'payment.webhook',
        providerReference: 'FUND-1',
        status: 'PROCESSING',
      }),
      select: { id: true, status: true },
    });
    expect(prisma.providerEvent.update).toHaveBeenCalledWith({
      where: { id: 'provider-event-1' },
      data: {
        status: 'PROCESSED',
        processedAt: expect.any(Date),
      },
    });
  });

  it('rejects provider verification when amount, currency, or reference differs', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      status: 'PENDING',
      amount: new Decimal(100),
      currency: 'NGN',
      reference: 'FUND-1',
      metadata: { provider: 'paystack' },
    });
    paystack.verifyPayment.mockResolvedValue({
      reference: 'OTHER',
      status: 'success',
      amount: 10000,
      currency: 'NGN',
    });

    await expect(
      service.verifyPayment('FUND-1', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });
});
