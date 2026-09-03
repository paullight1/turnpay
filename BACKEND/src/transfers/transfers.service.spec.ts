import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { recipientPreviewDelayMs, TransfersService } from './transfers.service';
import { LedgerService } from '../wallets/ledger.service';
import { InternalTransferResponse } from './internal-transfer-idempotency.service';

describe('TransfersService', () => {
  it('normalizes recipient-preview timing to a bounded deterministic window', () => {
    const startedAt = 1_000;
    const first = recipientPreviewDelayMs(
      startedAt,
      'recipient@example.com',
      startedAt,
    );
    const repeated = recipientPreviewDelayMs(
      startedAt,
      'recipient@example.com',
      startedAt,
    );

    expect(first).toBe(repeated);
    expect(first).toBeGreaterThanOrEqual(120);
    expect(first).toBeLessThanOrEqual(150);
    expect(
      recipientPreviewDelayMs(
        startedAt,
        'recipient@example.com',
        startedAt + 1_000,
      ),
    ).toBe(0);
  });

  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    internalTransferLimitUsage: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    internalTransferAttempt: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const ledger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const transactionPin = {
    verifyRequired: jest.fn(),
  };
  const idempotency = {
    hashKey: jest.fn(),
    fingerprint: jest.fn(),
    findReplay: jest.fn(),
    createProcessing: jest.fn(),
    complete: jest.fn(),
    isBusinessKeyConflict: jest.fn(),
  };
  const limitPolicy = {
    getActivePolicy: jest.fn(),
    assertAmountWithinPolicy: jest.fn(),
  };
  const postCommitHook = {
    afterCommit: jest.fn(),
  };
  const requestContext = {
    idempotencyKey: 'transfer-key-1',
    requestId: 'request-1',
    ipAddress: '203.0.113.10',
    userAgent: 'jest-agent',
  };

  let service: TransfersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.internalTransferLimitUsage.upsert.mockResolvedValue({});
    prisma.internalTransferLimitUsage.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.internalTransferAttempt.create.mockResolvedValue({
      id: 'attempt-1',
    });
    prisma.internalTransferAttempt.findFirst.mockResolvedValue(null);
    prisma.auditLog.create.mockResolvedValue({});
    prisma.transaction.update.mockResolvedValue({});
    idempotency.hashKey.mockReturnValue('a'.repeat(64));
    idempotency.fingerprint.mockReturnValue('b'.repeat(64));
    idempotency.findReplay.mockResolvedValue(null);
    idempotency.createProcessing.mockResolvedValue({ id: 'attempt-1' });
    idempotency.complete.mockResolvedValue(undefined);
    idempotency.isBusinessKeyConflict.mockReturnValue(false);
    limitPolicy.assertAmountWithinPolicy.mockReset();
    limitPolicy.getActivePolicy.mockResolvedValue({
      id: 'ngn-tier-2-v1',
      currency: 'NGN',
      kycTier: 'TIER_2',
      perTransaction: new Decimal('250000.00'),
      daily: new Decimal('1000000.00'),
      monthly: new Decimal('5000000.00'),
      enabled: true,
      version: 1,
    });
    service = new TransfersService(
      prisma,
      ledger as unknown as LedgerService,
      logger as any,
      transactionPin as any,
      idempotency as any,
      limitPolicy as any,
      postCommitHook,
    );
  });

  it('debits sender, credits recipient, and creates both transaction records atomically', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-1',
      email: 'recipient@example.com',
      phone: '+2348012345678',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.transaction.create
      .mockResolvedValueOnce({
        id: 'tx-out',
        reference: 'IT-20260516-abc123-OUT',
      })
      .mockResolvedValueOnce({
        id: 'tx-in',
        reference: 'IT-20260516-abc123-IN',
      });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(750),
    });
    ledger.creditWallet.mockResolvedValue({
      balanceAfter: new Decimal(250),
    });

    const result = await service.sendInternalTransfer(
      'sender-1',
      {
        recipientEmail: 'recipient@example.com',
        amount: '250',
        currency: 'NGN',
        note: 'Lunch',
      },
      requestContext,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
    expect(prisma.internalTransferLimitUsage.updateMany).toHaveBeenCalledTimes(
      2,
    );
    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'sender-1',
        amount: new Decimal(250),
        transactionId: 'tx-out',
        source: 'INTERNAL_TRANSFER_OUT',
      }),
      prisma,
    );
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'recipient-1',
        amount: new Decimal(250),
        transactionId: 'tx-in',
        source: 'INTERNAL_TRANSFER_IN',
      }),
      prisma,
    );
    expect(result.status).toBe('SUCCESS');
    expect(result.recipient.maskedIdentifier).toBe('r***@example.com');
    expect(result).not.toHaveProperty('recipientTransactionReference');
    expect(idempotency.createProcessing).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'sender-1',
        keyHash: 'a'.repeat(64),
        requestHash: 'b'.repeat(64),
        context: requestContext,
      }),
    );
    expect(idempotency.complete).toHaveBeenCalledWith(
      prisma,
      'attempt-1',
      expect.objectContaining({
        recipientUserId: 'recipient-1',
        amount: new Decimal(250),
        currency: 'NGN',
        recipientIdentifierType: 'EMAIL',
        recipientMaskedIdentifier: 'r***@example.com',
        response: result,
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'internal_transfer_completed',
        targetType: 'INTERNAL_TRANSFER',
        targetId: 'attempt-1',
        reference: result.reference,
        metadata: expect.objectContaining({
          requestId: 'request-1',
          idempotencyKeyDigest: 'aaaaaaaaaaaa',
        }),
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 2_000,
      timeout: 5_000,
    });
    expect(limitPolicy.getActivePolicy).toHaveBeenCalledWith(
      prisma,
      'NGN',
      'TIER_2',
    );
    expect(limitPolicy.assertAmountWithinPolicy).toHaveBeenCalledWith(
      new Decimal('250'),
      expect.objectContaining({ id: 'ngn-tier-2-v1' }),
    );
  });

  it('returns the exact committed response for an idempotent retry before revalidating PIN', async () => {
    const committedResponse: InternalTransferResponse = {
      reference: 'IT-committed',
      status: 'SUCCESS',
      amount: '250',
      currency: 'NGN',
      senderTransactionReference: 'IT-committed-OUT',
      senderBalanceAfter: '750',
      recipient: {
        maskedIdentifier: 'r***@example.com',
        avatarInitials: 'R',
      },
      createdAt: '2026-09-01T12:00:00.000Z',
    };
    idempotency.findReplay.mockResolvedValue(committedResponse);

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).resolves.toEqual(committedResponse);

    expect(transactionPin.verifyRequired).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replays the committed response after losing a cross-instance idempotency race', async () => {
    const committedResponse: InternalTransferResponse = {
      reference: 'IT-race-winner',
      status: 'SUCCESS',
      amount: '250',
      currency: 'NGN',
      senderTransactionReference: 'IT-race-winner-OUT',
      senderBalanceAfter: '750',
      recipient: {
        maskedIdentifier: 'r***@example.com',
        avatarInitials: 'R',
      },
      createdAt: '2026-09-01T12:00:00.000Z',
    };
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-1',
      email: 'recipient@example.com',
      phone: '+2348012345678',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    idempotency.findReplay
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(committedResponse);
    idempotency.isBusinessKeyConflict.mockReturnValue(true);
    prisma.$transaction.mockRejectedValueOnce(new Error('unique conflict'));

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).resolves.toEqual(committedResponse);

    expect(idempotency.findReplay).toHaveBeenCalledTimes(2);
    expect(prisma.internalTransferAttempt.create).not.toHaveBeenCalled();
  });

  it('rejects Tier 2 internal transfers above the per-transaction limit', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-1',
      email: 'recipient@example.com',
      phone: '+2348012345678',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    limitPolicy.assertAmountWithinPolicy.mockImplementation(() => {
      throw new BadRequestException('Internal transfer limit exceeded');
    });

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          amount: '250000.01',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).rejects.toThrow('Internal transfer limit exceeded');

    expect(prisma.internalTransferAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'sender-1',
        status: 'FAILED',
        amount: new Decimal('250000.01'),
        currency: 'NGN',
        failureCode: 'BAD_REQUEST',
      }),
    });
  });

  it('loads a distinct GHS policy for GHS transfers', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_3',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-1',
      email: 'recipient@example.com',
      phone: '+233201234567',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    limitPolicy.getActivePolicy.mockRejectedValue(
      new Error('GHS policy unavailable'),
    );

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          amount: '10',
          currency: 'GHS',
        },
        requestContext,
      ),
    ).rejects.toThrow('GHS policy unavailable');

    expect(limitPolicy.getActivePolicy).toHaveBeenCalledWith(
      prisma,
      'GHS',
      'TIER_3',
    );
  });

  it('rejects transfers when daily or monthly usage cannot be reserved', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-1',
      email: 'recipient@example.com',
      phone: '+2348012345678',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.internalTransferLimitUsage.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).rejects.toThrow('daily internal transfer limit exceeded');

    expect(ledger.debitWallet).not.toHaveBeenCalled();
    expect(prisma.internalTransferAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'sender-1',
        recipientUserId: 'recipient-1',
        status: 'FAILED',
        failureCode: 'BAD_REQUEST',
      }),
    });
  });

  it('requires verified sender KYC', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'PENDING',
      isSuspended: false,
    });

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('requires sender KYC tier 2 for money transfers', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
      isSuspended: false,
    });

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).rejects.toThrow('sender must be at least Tier 2 for transfers');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('uses a privacy-safe error for blocked recipients', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-1',
      email: 'recipient@example.com',
      phone: '+2348012345678',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: true,
    });

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).rejects.toThrow('Recipient cannot be found or used');
  });

  it('rejects transfer to self', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'sender-1',
      email: 'sender@example.com',
      phone: '+2348012345678',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'sender@example.com',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a privacy-safe error for unknown recipients', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'missing@example.com',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires exactly one recipient identifier', async () => {
    await expect(
      service.sendInternalTransfer(
        'sender-1',
        {
          recipientEmail: 'recipient@example.com',
          recipientPhone: '+2348012345678',
          amount: '250',
          currency: 'NGN',
        },
        requestContext,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('previews an eligible recipient with a masked display name only', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-1',
      email: 'recipient@example.com',
      phone: '+2348012345678',
      fullName: 'Ada Grace Lovelace',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });

    const preview = await service.previewRecipient('sender-1', {
      recipientEmail: 'recipient@example.com',
    });

    expect(preview.found).toBe(true);
    expect(preview.displayName).toBe('Ada G. L.');
    expect(preview.displayName).not.toContain('Lovelace');
    expect(preview.maskedIdentifier).not.toBe('recipient@example.com');
    expect(preview.avatarInitials).toBe('A');
  });

  it('preview rejects self-transfers and hides ineligible recipients', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'sender-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'sender-1',
      email: 'self@example.com',
      fullName: 'Self User',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });

    await expect(
      service.previewRecipient('sender-1', {
        recipientEmail: 'self@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-1',
      email: 'recipient@example.com',
      fullName: 'Ada Lovelace',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
      isSuspended: false,
    });

    const ineligible = await service.previewRecipient('sender-1', {
      recipientEmail: 'recipient@example.com',
    });

    prisma.user.findFirst.mockResolvedValue(null);
    const unknown = await service.previewRecipient('sender-1', {
      recipientEmail: 'missing@example.com',
    });

    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-2',
      email: 'suspended@example.com',
      fullName: 'Suspended User',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: true,
    });
    const suspended = await service.previewRecipient('sender-1', {
      recipientEmail: 'suspended@example.com',
    });

    prisma.user.findFirst.mockResolvedValue({
      id: 'recipient-3',
      email: 'unverified@example.com',
      fullName: 'Unverified User',
      kycStatus: 'PENDING',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    const unverified = await service.previewRecipient('sender-1', {
      recipientEmail: 'unverified@example.com',
    });

    expect(ineligible).toEqual({ found: false });
    expect(unknown).toEqual(ineligible);
    expect(suspended).toEqual(ineligible);
    expect(unverified).toEqual(ineligible);
    expect(
      JSON.stringify([ineligible, unknown, suspended, unverified]),
    ).not.toContain('example.com');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'RECIPIENT_ENUMERATION_SIGNAL',
        actorUserId: 'sender-1',
        identifierDigest: expect.stringMatching(/^[a-f0-9]{12}$/),
      }),
      'Recipient preview returned the uniform unavailable response',
    );
  });

  it('returns sanitized transfer details for the owner reference', async () => {
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-out',
      reference: 'IT-20260516-abc123-OUT',
      type: 'INTERNAL_TRANSFER',
      amount: new Decimal(250),
      currency: 'NGN',
      status: 'SUCCESS',
      metadata: {
        direction: 'OUT',
        transferReference: 'IT-20260516-abc123',
        counterpartyUserId: 'recipient-1',
        counterpartyMaskedIdentifier: 'r***@example.com',
        note: 'Lunch',
      },
      createdAt: new Date('2026-05-16T12:00:00Z'),
      updatedAt: new Date('2026-05-16T12:00:00Z'),
    });
    prisma.internalTransferAttempt.findFirst.mockResolvedValue({
      reversal: {
        status: 'COMPLETED',
        reversalReference: 'ITR-20260901-reversal',
      },
    });

    const result = await service.getInternalTransferByReference(
      'sender-1',
      'IT-20260516-abc123',
    );

    expect(result).toEqual(
      expect.objectContaining({
        reference: 'IT-20260516-abc123',
        transactionReference: 'IT-20260516-abc123-OUT',
        direction: 'OUT',
        counterparty: {
          maskedIdentifier: 'r***@example.com',
        },
        note: 'Lunch',
        reversalStatus: 'COMPLETED',
        reversalReference: 'ITR-20260901-reversal',
      }),
    );
    expect(result).not.toHaveProperty('metadata');
  });
});
