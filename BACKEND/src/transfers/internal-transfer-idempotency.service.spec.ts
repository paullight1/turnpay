import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InternalTransferIdempotencyService } from './internal-transfer-idempotency.service';

describe('InternalTransferIdempotencyService', () => {
  const prisma = {
    internalTransferAttempt: {
      findUnique: jest.fn(),
    },
  };
  let service: InternalTransferIdempotencyService;

  const response = {
    reference: 'IT-20260901-abc123',
    status: 'SUCCESS',
    amount: '12.34',
    currency: 'NGN',
    senderTransactionReference: 'IT-20260901-abc123-OUT',
    senderBalanceAfter: '237.66',
    recipient: {
      maskedIdentifier: 'r***@example.com',
      avatarInitials: 'R',
    },
    createdAt: '2026-09-01T10:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InternalTransferIdempotencyService(prisma as never);
  });

  it('hashes raw idempotency keys without retaining the source value', () => {
    const digest = service.hashKey('transfer-attempt-1');

    expect(digest).toBe(
      'c336023b0e1d941751efeaa44e88ee2791e10dcee844429fbceb74262e466fd6',
    );
    expect(digest).not.toContain('transfer-attempt-1');
  });

  it('fingerprints business fields deterministically and excludes the PIN', () => {
    const first = service.fingerprint({
      recipientEmail: 'Recipient@Example.com',
      amount: '12.340',
      currency: 'NGN',
      note: 'Lunch',
      transactionPin: '1234',
    });
    const retry = service.fingerprint({
      recipientEmail: 'recipient@example.com',
      amount: '12.34',
      currency: 'NGN',
      note: 'Lunch',
      transactionPin: '9876',
    });
    const changedAmount = service.fingerprint({
      recipientEmail: 'recipient@example.com',
      amount: '12.35',
      currency: 'NGN',
      note: 'Lunch',
      transactionPin: '1234',
    });

    expect(first).toBe(retry);
    expect(first).not.toBe(changedAmount);
  });

  it('returns null when no committed business attempt exists', async () => {
    prisma.internalTransferAttempt.findUnique.mockResolvedValue(null);

    await expect(
      service.findReplay('sender-1', 'key-hash', 'request-hash'),
    ).resolves.toBeNull();
  });

  it('replays the exact committed response for the same business request', async () => {
    prisma.internalTransferAttempt.findUnique.mockResolvedValue({
      status: 'SUCCESS',
      requestHash: 'request-hash',
      response,
    });

    await expect(
      service.findReplay('sender-1', 'key-hash', 'request-hash'),
    ).resolves.toEqual(response);
  });

  it('rejects reuse of a business key for a different transfer body', async () => {
    prisma.internalTransferAttempt.findUnique.mockResolvedValue({
      status: 'SUCCESS',
      requestHash: 'original-hash',
      response,
    });

    await expect(
      service.findReplay('sender-1', 'key-hash', 'changed-hash'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a non-terminal attempt instead of executing a second transfer', async () => {
    prisma.internalTransferAttempt.findUnique.mockResolvedValue({
      status: 'PROCESSING',
      requestHash: 'request-hash',
      response: null,
    });

    await expect(
      service.findReplay('sender-1', 'key-hash', 'request-hash'),
    ).rejects.toThrow(
      'Transfer with this idempotency key is already in progress',
    );
  });

  it('recognizes only the internal-transfer business unique constraint', () => {
    const matching = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: {
        target: ['userId', 'idempotencyKeyHash'],
      },
    });
    const unrelated = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['reference'] },
    });

    expect(service.isBusinessKeyConflict(matching)).toBe(true);
    expect(service.isBusinessKeyConflict(unrelated)).toBe(false);
    expect(service.isBusinessKeyConflict(new Error('connection lost'))).toBe(
      false,
    );
  });
});
