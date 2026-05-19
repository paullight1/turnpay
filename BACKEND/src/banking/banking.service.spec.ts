import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { BankingService } from './banking.service';
import { LedgerService } from '../wallets/ledger.service';

describe('BankingService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    virtualAccount: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
    providerEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const paystackVirtualAccounts = {
    provisionVirtualAccount: jest.fn(),
  };

  const ledger = {
    creditWallet: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let service: BankingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BankingService(
      prisma,
      ledger as unknown as LedgerService,
      paystackVirtualAccounts as any,
      logger as any,
    );
  });

  it('requires verified KYC before provisioning a virtual account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      phone: '+2348012345678',
      kycStatus: 'PENDING',
      isSuspended: false,
    });

    await expect(
      service.provisionVirtualAccount('user-1', {
        currency: 'NGN',
        provider: 'paystack',
        firstName: 'Ada',
        lastName: 'Lovelace',
        country: 'NG',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      paystackVirtualAccounts.provisionVirtualAccount,
    ).not.toHaveBeenCalled();
  });

  it('upserts a provider virtual account without exposing raw provider internals', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      phone: '+2348012345678',
      kycStatus: 'VERIFIED',
      isSuspended: false,
    });
    paystackVirtualAccounts.provisionVirtualAccount.mockResolvedValue({
      provider: 'paystack',
      providerAccountId: '253',
      providerCustomerId: 'CUS_abc',
      accountNumber: '9930000737',
      accountName: 'TRUSTPAY/ADA LOVELACE',
      bankName: 'Titan Paystack',
      bankCode: 'titan-paystack',
      currency: 'NGN',
      status: 'ACTIVE',
      raw: { account_number: '9930000737' },
    });
    prisma.virtualAccount.upsert.mockResolvedValue({
      id: 'va-1',
      accountNumber: '9930000737',
      accountNumberMasked: '******0737',
      bankName: 'Titan Paystack',
      status: 'ACTIVE',
    });

    const result = await service.provisionVirtualAccount('user-1', {
      currency: 'NGN',
      provider: 'paystack',
      firstName: 'Ada',
      lastName: 'Lovelace',
      country: 'NG',
    });

    expect(prisma.virtualAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_provider_currency: {
            userId: 'user-1',
            provider: 'PAYSTACK',
            currency: 'NGN',
          },
        },
      }),
    );
    expect(result.accountNumberMasked).toBe('******0737');
  });

  it('credits a wallet once for a valid virtual-account deposit event', async () => {
    prisma.providerEvent.findUnique.mockResolvedValue(null);
    prisma.providerEvent.create.mockResolvedValue({ id: 'event-1' });
    prisma.virtualAccount.findUnique.mockResolvedValue({
      id: 'va-1',
      userId: 'user-1',
      accountNumber: '9930000737',
      currency: 'NGN',
      provider: 'PAYSTACK',
      status: 'ACTIVE',
      user: {
        id: 'user-1',
        isSuspended: false,
        kycStatus: 'VERIFIED',
      },
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'PSK-1',
      amount: new Decimal(2500),
      currency: 'NGN',
    });
    ledger.creditWallet.mockResolvedValue({ balanceAfter: new Decimal(2500) });

    const result = await service.processVirtualAccountDeposit({
      provider: 'paystack',
      eventType: 'charge.success',
      providerReference: 'PSK-1',
      accountNumber: '9930000737',
      amount: new Decimal(2500),
      currency: 'NGN',
      rawPayload: {
        data: {
          reference: 'PSK-1',
          authorization: {
            receiver_bank_account_number: '9930000737',
            sender_bank_account_number: '1234567890',
          },
        },
      },
    });

    expect(result).toEqual({ received: true, processed: true });
    expect(prisma.providerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'PAYSTACK',
          providerReference: 'PSK-1',
          status: 'PROCESSING',
        }),
      }),
    );
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(2500),
        transactionId: 'tx-1',
        reference: 'PSK-1',
      }),
      prisma,
    );
    expect(prisma.providerEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: 'PROCESSED', processedAt: expect.any(Date) },
    });
  });

  it('does not double-credit duplicate provider events', async () => {
    prisma.providerEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      status: 'PROCESSED',
    });

    const result = await service.processVirtualAccountDeposit({
      provider: 'paystack',
      eventType: 'charge.success',
      providerReference: 'PSK-1',
      accountNumber: '9930000737',
      amount: new Decimal(2500),
      currency: 'NGN',
      rawPayload: {},
    });

    expect(result).toEqual({ received: true, processed: false });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('rejects deposits where the provider currency does not match the virtual account', async () => {
    prisma.providerEvent.findUnique.mockResolvedValue(null);
    prisma.providerEvent.create.mockResolvedValue({ id: 'event-1' });
    prisma.virtualAccount.findUnique.mockResolvedValue({
      id: 'va-1',
      userId: 'user-1',
      accountNumber: '9930000737',
      currency: 'NGN',
      provider: 'PAYSTACK',
      status: 'ACTIVE',
      user: {
        id: 'user-1',
        isSuspended: false,
        kycStatus: 'VERIFIED',
      },
    });

    await expect(
      service.processVirtualAccountDeposit({
        provider: 'paystack',
        eventType: 'charge.success',
        providerReference: 'PSK-1',
        accountNumber: '9930000737',
        amount: new Decimal(2500),
        currency: 'GHS',
        rawPayload: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(prisma.providerEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        status: 'FAILED',
        errorMessage: 'Deposit currency does not match virtual account',
        processedAt: expect.any(Date),
      },
    });
  });
});
