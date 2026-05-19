import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  const prisma = {
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  let service: LedgerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LedgerService(prisma);
  });

  it('credits a wallet and records the balance movement in one transaction', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: new Decimal(1000),
    });
    prisma.wallet.update.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(1250),
    });
    prisma.ledgerEntry.create.mockResolvedValue({ id: 'ledger-1' });

    const result = await service.creditWallet({
      userId: 'user-1',
      currency: 'NGN',
      amount: new Decimal(250),
      transactionId: 'tx-1',
      reference: 'DEP-1',
      source: 'PAYSTACK_DVA',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { balance: { increment: new Decimal(250) } },
    });
    expect(prisma.ledgerEntry.create).toHaveBeenCalledWith({
      data: {
        transactionId: 'tx-1',
        walletId: 'wallet-1',
        direction: 'CREDIT',
        amount: new Decimal(250),
        currency: 'NGN',
        balanceBefore: new Decimal(1000),
        balanceAfter: new Decimal(1250),
        reference: 'DEP-1',
        source: 'PAYSTACK_DVA',
        metadata: undefined,
      },
    });
    expect(result.balanceAfter.equals(1250)).toBe(true);
  });

  it('rejects non-positive credit amounts', async () => {
    await expect(
      service.creditWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(0),
        transactionId: 'tx-1',
        reference: 'DEP-1',
        source: 'PAYSTACK_DVA',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects debit attempts that would overdraw the wallet', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'NGN',
      balance: new Decimal(100),
    });

    await expect(
      service.debitWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(250),
        transactionId: 'tx-1',
        reference: 'WD-1',
        source: 'WITHDRAWAL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('fails when the target wallet does not exist', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null);

    await expect(
      service.creditWallet({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal(250),
        transactionId: 'tx-1',
        reference: 'DEP-1',
        source: 'PAYSTACK_DVA',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
