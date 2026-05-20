import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { VtuService } from './vtu.service';

describe('VtuService purchase ledger handling', () => {
  const prisma = {
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const walletsService = {
    getWallet: jest.fn(),
  };

  const vtuApi = {
    getProviders: jest.fn(),
    getPackages: jest.fn(),
    validateSmartCard: jest.fn(),
    validateMeter: jest.fn(),
    purchase: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    error: jest.fn(),
  };

  const ledger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };

  let service: VtuService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VtuService(
      prisma,
      walletsService as any,
      vtuApi as any,
      logger as any,
      ledger as any,
    );
  });

  it('creates a pending VTU transaction and debits wallet through the ledger', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'success',
      message: 'Airtime delivered',
    });

    const result = await service.purchase('user-1', {
      type: 'airtime',
      provider: 'mtn',
      recipientNumber: '+2348012345678',
      amount: 500,
    });

    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        currency: 'NGN',
        amount: expect.any(Decimal),
        transactionId: 'tx-1',
        source: 'VTU_PURCHASE',
        metadata: expect.objectContaining({
          vtuType: 'airtime',
          provider: 'mtn',
          recipientNumberMasked: expect.any(String),
        }),
      }),
      prisma,
    );
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { reference: 'VTU-1' },
      data: {
        status: 'SUCCESS',
        metadata: expect.objectContaining({
          providerReference: 'provider-vtu-1',
        }),
      },
    });
    expect(result.success).toBe(true);
  });

  it('reverses a failed VTU purchase through a single reversal ledger entry', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'failed',
      message: 'Provider rejected request',
    });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await expect(
      service.purchase('user-1', {
        type: 'data',
        provider: 'mtn',
        recipientNumber: '+2348012345678',
        amount: 500,
        packageId: 'mtn-1gb',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        currency: 'NGN',
        amount: expect.any(Decimal),
        transactionId: 'tx-1',
        reference: 'VTU-1-REVERSAL',
        source: 'VTU_REVERSAL',
      }),
      prisma,
    );
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { reference: 'VTU-1' },
      data: {
        status: 'FAILED',
        metadata: expect.objectContaining({
          reversalReason: 'Provider rejected request',
        }),
      },
    });
  });
});
