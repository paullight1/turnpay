import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'node:crypto';
import { LedgerService } from '../wallets/ledger.service';
import { InternalTransferReversalService } from './internal-transfer-reversal.service';

describe('InternalTransferReversalService', () => {
  const prisma = {
    internalTransferAttempt: { findFirst: jest.fn() },
    internalTransferReversal: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    transaction: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const ledger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const context = {
    idempotencyKey: 'reversal-key-1',
    requestId: 'request-1',
    ipAddress: '203.0.113.10',
    userAgent: 'jest-agent',
  };
  const originalAttempt = {
    id: 'attempt-1',
    userId: 'sender-1',
    recipientUserId: 'recipient-1',
    transferReference: 'IT-original',
    senderTransactionId: 'tx-out',
    recipientTransactionId: 'tx-in',
    status: 'SUCCESS',
    amount: new Decimal('250.00'),
    currency: 'NGN',
  };
  let service: InternalTransferReversalService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.internalTransferAttempt.findFirst.mockResolvedValue(originalAttempt);
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-out',
        userId: 'sender-1',
        amount: new Decimal('250'),
        currency: 'NGN',
      },
      {
        id: 'tx-in',
        userId: 'recipient-1',
        amount: new Decimal('250'),
        currency: 'NGN',
      },
    ]);
    prisma.internalTransferReversal.findUnique.mockResolvedValue(null);
    prisma.internalTransferReversal.findFirst.mockResolvedValue(null);
    prisma.internalTransferReversal.create.mockResolvedValue({
      id: 'reversal-1',
      originalAttemptId: 'attempt-1',
      status: 'PENDING_APPROVAL',
      requesterAdminId: 'admin-requester',
      requestReason: 'Customer dispute case OPS-1234',
    });
    prisma.auditLog.create.mockResolvedValue({});
    service = new InternalTransferReversalService(
      prisma as never,
      ledger as unknown as LedgerService,
      logger as never,
    );
  });

  it('replays a duplicate request carrying the same idempotency key and body', async () => {
    const replay = {
      id: 'reversal-1',
      status: 'PENDING_APPROVAL',
      requesterAdminId: 'admin-requester',
      requestHash: createHash('sha256')
        .update(
          JSON.stringify({
            reference: 'IT-original',
            reason: 'Customer dispute case OPS-1234',
          }),
        )
        .digest('hex'),
    };
    prisma.internalTransferReversal.findUnique.mockResolvedValue(replay);

    const result = await service.requestReversal(
      'IT-original',
      { reason: 'Customer dispute case OPS-1234' },
      'admin-requester',
      context,
    );

    expect(result).toBe(replay);
    expect(prisma.internalTransferAttempt.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a second reversal request for an already reversed transfer', async () => {
    prisma.internalTransferReversal.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'reversal-complete',
        status: 'COMPLETED',
      });

    await expect(
      service.requestReversal(
        'IT-original',
        { reason: 'Customer dispute case OPS-1234' },
        'admin-requester',
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects inconsistent original transaction currency before creating a request', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-out',
        userId: 'sender-1',
        amount: new Decimal('250'),
        currency: 'NGN',
      },
      {
        id: 'tx-in',
        userId: 'recipient-1',
        amount: new Decimal('250'),
        currency: 'GHS',
      },
    ]);

    await expect(
      service.requestReversal(
        'IT-original',
        { reason: 'Customer dispute case OPS-1234' },
        'admin-requester',
        context,
      ),
    ).rejects.toThrow('Original transfer records are inconsistent');
    expect(prisma.internalTransferReversal.create).not.toHaveBeenCalled();
  });

  it('does not allow the requester to approve their own reversal', async () => {
    prisma.internalTransferReversal.findUnique.mockResolvedValue({
      id: 'reversal-1',
      requesterAdminId: 'admin-requester',
      status: 'PENDING_APPROVAL',
    });

    await expect(
      service.approveReversal(
        'reversal-1',
        { reason: 'Independent operations approval' },
        'admin-requester',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ledger.debitWallet).not.toHaveBeenCalled();
  });

  it('allows only one concurrent approval claim', async () => {
    prisma.internalTransferReversal.findUnique.mockResolvedValue({
      ...originalAttempt,
      id: 'reversal-1',
      originalAttemptId: 'attempt-1',
      senderUserId: 'sender-1',
      recipientUserId: 'recipient-1',
      originalTransferReference: 'IT-original',
      requesterAdminId: 'admin-requester',
      status: 'PENDING_APPROVAL',
      requestReason: 'Customer dispute case OPS-1234',
    });
    prisma.internalTransferReversal.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.approveReversal(
        'reversal-1',
        { reason: 'Independent operations approval' },
        'admin-approver',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ledger.debitWallet).not.toHaveBeenCalled();
  });

  it('marks an insufficient-funds reversal blocked without crediting the sender', async () => {
    prisma.internalTransferReversal.findUnique.mockResolvedValue({
      id: 'reversal-1',
      originalAttemptId: 'attempt-1',
      originalTransferReference: 'IT-original',
      originalSenderTransactionId: 'tx-out',
      originalRecipientTransactionId: 'tx-in',
      senderUserId: 'sender-1',
      recipientUserId: 'recipient-1',
      amount: new Decimal('250'),
      currency: 'NGN',
      requesterAdminId: 'admin-requester',
      status: 'PENDING_APPROVAL',
      requestReason: 'Customer dispute case OPS-1234',
    });
    prisma.internalTransferReversal.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    ledger.debitWallet.mockRejectedValue(new Error('Insufficient NGN balance'));
    prisma.transaction.create
      .mockResolvedValueOnce({ id: 'reversal-recipient-tx' })
      .mockResolvedValueOnce({ id: 'reversal-sender-tx' });
    prisma.internalTransferReversal.update.mockResolvedValue({
      id: 'reversal-1',
      status: 'BLOCKED',
    });

    await expect(
      service.approveReversal(
        'reversal-1',
        { reason: 'Independent operations approval' },
        'admin-approver',
      ),
    ).resolves.toMatchObject({ status: 'BLOCKED' });

    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(prisma.internalTransferReversal.update).toHaveBeenCalledWith({
      where: { id: 'reversal-1' },
      data: expect.objectContaining({ status: 'BLOCKED' }),
    });
  });
});
