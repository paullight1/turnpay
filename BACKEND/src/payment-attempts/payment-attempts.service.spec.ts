import { createHash } from 'crypto';
import { PaymentAttemptsService } from './payment-attempts.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PaymentAttemptsService', () => {
  const key = 'attempt-key-123456789';
  let db: {
    internalTransferAttempt: { findUnique: jest.Mock };
    idempotencyRecord: { findUnique: jest.Mock };
    transaction: { findFirst: jest.Mock };
  };
  let service: PaymentAttemptsService;
  beforeEach(() => {
    db = {
      internalTransferAttempt: { findUnique: jest.fn() },
      idempotencyRecord: { findUnique: jest.fn() },
      transaction: { findFirst: jest.fn() },
    };
    service = new PaymentAttemptsService(db as unknown as PrismaService);
  });
  it('never treats missing, expired, in-progress or failed HTTP cache entries as a failed payment', async () => {
    for (const record of [
      null,
      { expiresAt: new Date(0), status: 'COMPLETED' },
      { expiresAt: new Date(Date.now() + 60000), status: 'IN_PROGRESS' },
      { expiresAt: new Date(Date.now() + 60000), status: 'FAILED_FINAL' },
    ]) {
      db.idempotencyRecord.findUnique.mockResolvedValue(record);
      expect(
        await service.resolve('owner', {
          operation: 'WITHDRAWAL',
          attemptKey: key,
        }),
      ).toEqual({ state: 'UNKNOWN' });
    }
    expect(db.transaction.findFirst).not.toHaveBeenCalled();
  });
  it('scopes key and transaction ownership, returning current status instead of cached status', async () => {
    db.idempotencyRecord.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60000),
      status: 'COMPLETED',
      response: { reference: 'VTU-1', status: 'PENDING' },
    });
    db.transaction.findFirst.mockResolvedValue({
      reference: 'VTU-1',
      status: 'REVERSED',
    });
    expect(
      await service.resolve('owner', {
        operation: 'VTU_PURCHASE',
        attemptKey: key,
      }),
    ).toEqual({ state: 'REVERSED', reference: 'VTU-1' });
    expect(db.idempotencyRecord.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scope_key: {
            scope: 'owner:POST:/api/vtu/purchase',
            key: createHash('sha256').update(key).digest('hex'),
          },
        },
      }),
    );
    expect(db.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'owner', reference: 'VTU-1' }),
      }),
    );
    db.transaction.findFirst.mockResolvedValue(null);
    expect(
      await service.resolve('other-owner', {
        operation: 'VTU_PURCHASE',
        attemptKey: key,
      }),
    ).toEqual({ state: 'UNKNOWN' });
  });
  it('resolves durable internal-transfer evidence and completed reversal without reading another account', async () => {
    db.internalTransferAttempt.findUnique.mockResolvedValue({
      status: 'SUCCESS',
      transferReference: 'TRF-1',
      reversal: { status: 'COMPLETED' },
    });
    expect(
      await service.resolve('owner', {
        operation: 'INTERNAL_TRANSFER',
        attemptKey: key,
      }),
    ).toEqual({ state: 'REVERSED', reference: 'TRF-1' });
    expect(db.internalTransferAttempt.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_idempotencyKeyHash: {
            userId: 'owner',
            idempotencyKeyHash: createHash('sha256').update(key).digest('hex'),
          },
        },
      }),
    );
  });
});
