import { BadRequestException } from '@nestjs/common';
import { PaymentService } from './payment.service';

describe('PaymentService funding', () => {
  const prisma = {
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const wallets = {};
  const users = {
    findOne: jest.fn(),
  };
  const paystack = {
    initializePayment: jest.fn(),
  };
  const flutterwave = {
    initializePayment: jest.fn(),
  };
  const monnifyBanks = {};
  const config: {
    get: jest.Mock<string | undefined, [string]>;
    getOrThrow: jest.Mock<string, [string]>;
  } = {
    get: jest.fn((key: string) => {
      if (key === 'WEB_URL') return 'https://app.trustpay.example';
      if (key === 'NODE_ENV') return 'production';
      return undefined;
    }),
    getOrThrow: jest.fn((key: string) => (key ? 'secret' : 'secret')),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const http = {};
  const ledger = {};
  const transactionPin = {};

  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.transaction.create.mockResolvedValue({});
    prisma.transaction.update.mockResolvedValue({});
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    paystack.initializePayment.mockResolvedValue({
      data: {
        authorization_url: 'https://paystack.example/pay',
        reference: 'FUND-1',
      },
    });
    flutterwave.initializePayment.mockResolvedValue({
      paymentUrl: 'https://flutterwave.example/pay',
      transactionId: 123,
    });
    service = new PaymentService(
      prisma as any,
      wallets as any,
      users as any,
      paystack as any,
      flutterwave as any,
      monnifyBanks as any,
      config as any,
      logger as any,
      http as any,
      ledger as any,
      transactionPin as any,
    );
  });

  it('builds Paystack callback URL server-side and sends minor-unit amount', async () => {
    await service.fundWallet('user-1', {
      amount: '1000.25',
      currency: 'NGN',
      provider: 'paystack',
      callbackUrl: 'https://evil.example/callback',
    } as any);

    expect(paystack.initializePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 100025,
        callbackUrl: 'https://app.trustpay.example/payment/callback',
      }),
    );
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          metadata: expect.objectContaining({
            provider: 'paystack',
            providerInitStatus: 'PENDING',
          }),
        }),
      }),
    );
    expect(prisma.transaction.create.mock.invocationCallOrder[0]).toBeLessThan(
      paystack.initializePayment.mock.invocationCallOrder[0],
    );
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            paymentUrl: 'https://paystack.example/pay',
            providerInitStatus: 'INITIALIZED',
          }),
        }),
      }),
    );
  });

  it('builds Flutterwave callback URL server-side and sends decimal-string amount', async () => {
    await service.fundWallet('user-1', {
      amount: '1000.25',
      currency: 'GHS',
      provider: 'flutterwave',
    });

    expect(flutterwave.initializePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '1000.25',
        redirectUrl: 'https://app.trustpay.example/payment/callback',
      }),
    );
  });

  it('marks the pending funding transaction failed when provider initialization fails', async () => {
    const providerError = new Error('provider unavailable');
    paystack.initializePayment.mockRejectedValue(providerError);

    await expect(
      service.fundWallet('user-1', {
        amount: '1000.25',
        currency: 'NGN',
        provider: 'paystack',
      }),
    ).rejects.toThrow(providerError);

    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          metadata: expect.objectContaining({
            providerInitStatus: 'PENDING',
          }),
        }),
      }),
    );
    expect(prisma.transaction.create.mock.invocationCallOrder[0]).toBeLessThan(
      paystack.initializePayment.mock.invocationCallOrder[0],
    );
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          metadata: expect.objectContaining({
            providerInitStatus: 'FAILED',
            providerErrorCode: 'PROVIDER_INITIALIZATION_FAILED',
          }),
        }),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        provider: 'paystack',
        error: 'provider unavailable',
      }),
      'Fund wallet provider initialization failed',
    );
  });

  it('rejects insecure production callback configuration', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'WEB_URL') return 'http://app.trustpay.example';
      if (key === 'NODE_ENV') return 'production';
      return undefined;
    });

    await expect(
      service.fundWallet('user-1', {
        amount: '1000.25',
        currency: 'NGN',
        provider: 'paystack',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(paystack.initializePayment).not.toHaveBeenCalled();
  });
});
