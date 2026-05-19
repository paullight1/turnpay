import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { AdminService } from './admin.service';

describe('AdminService banking operations', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    transaction: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    transferAttempt: {
      update: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  const ledger = {
    creditWallet: jest.fn(),
  };

  const paystack = {
    verifyTransfer: jest.fn(),
  };

  const flutterwave = {
    verifyTransfer: jest.fn(),
  };

  const supabase = {
    setAuthAppRole: jest.fn(),
  };

  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(
      prisma,
      logger as any,
      ledger as any,
      paystack as any,
      flutterwave as any,
      supabase as any,
    );
  });

  it('verifies withdrawal status from provider and audits the action', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      type: 'WITHDRAW',
      status: 'PENDING',
      amount: new Decimal(1000),
      currency: 'NGN',
      reference: 'WD-1',
      transferAttempts: [
        {
          id: 'attempt-1',
          provider: 'PAYSTACK',
          providerReference: 'WD-1',
          providerStatus: 'pending',
          status: 'PENDING',
          metadata: { accountNumberMasked: '******6789' },
        },
      ],
    });
    paystack.verifyTransfer.mockResolvedValue({
      status: 'success',
      reference: 'WD-1',
      amount: 100000,
      currency: 'NGN',
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    await service.verifyTransfer(
      'WD-1',
      { reason: 'Provider dashboard confirms payout completed' },
      'admin-1',
    );

    expect(paystack.verifyTransfer).toHaveBeenCalledWith('WD-1');
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'PENDING' },
      data: { status: 'SUCCESS' },
    });
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({
          status: 'SUCCESS',
          providerStatus: 'success',
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-1',
        action: 'TRANSFER_VERIFY',
        reference: 'WD-1',
        reason: 'Provider dashboard confirms payout completed',
      }),
    });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('reverses a failed provider withdrawal only when no reversal exists', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      type: 'WITHDRAW',
      status: 'PENDING',
      amount: new Decimal(1000),
      currency: 'NGN',
      reference: 'WD-1',
      transferAttempts: [
        {
          id: 'attempt-1',
          provider: 'PAYSTACK',
          providerReference: 'WD-1',
          providerStatus: 'pending',
          status: 'PENDING',
          metadata: {},
        },
      ],
    });
    paystack.verifyTransfer.mockResolvedValue({ status: 'failed' });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await service.verifyTransfer(
      'WD-1',
      { reason: 'Provider confirms transfer failed' },
      'admin-1',
    );

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        transactionId: 'tx-1',
        reference: 'WD-1-REVERSAL',
        source: 'WITHDRAWAL_REVERSAL',
      }),
      prisma,
    );
  });

  it('blocks generic status updates for withdrawal transactions', async () => {
    prisma.transaction.findUnique.mockResolvedValue({ type: 'WITHDRAW' });

    expect(() =>
      service.updateTransactionStatus('WD-1', 'SUCCESS', 'admin-1'),
    ).toThrow(BadRequestException);
  });
});
