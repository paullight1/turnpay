import { Prisma } from '@prisma/client';
import { KycWebhookInboxService } from './kyc-webhook-inbox.service';

describe('KycWebhookInboxService', () => {
  const prisma = {
    kycWebhookInbox: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const logger = { warn: jest.fn() };
  let service: KycWebhookInboxService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KycWebhookInboxService(prisma as any, logger as any);
  });

  const callback = {
    provider: 'YOUVERIFY' as const,
    status: 'REVIEW_REQUIRED' as const,
    reference: 'verification-1',
    checks: {
      providerStatus: 'found',
      allValidationPassed: false,
      dataValidation: true,
    },
    responseHash: 'stable-response-hash',
    documentType: 'NIN' as const,
    country: 'NG',
  };

  it('returns the existing event for an identical signed callback replay', async () => {
    prisma.kycWebhookInbox.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        clientVersion: '6.19.3',
        code: 'P2002',
      }),
    );
    prisma.kycWebhookInbox.findFirst.mockResolvedValue({ id: 'event-1' });

    await expect(
      service.accept({ eventType: 'identity.completed', result: callback }),
    ).resolves.toEqual({ eventId: 'event-1', duplicate: true });

    expect(prisma.kycWebhookInbox.findFirst).toHaveBeenCalledWith({
      where: {
        provider: 'YOUVERIFY',
        eventType: 'identity.completed',
        providerReference: 'verification-1',
        payloadHash: expect.any(String),
      },
      select: { id: true },
    });
  });

  it('dead-letters an event after the fifth failed processing attempt', async () => {
    prisma.kycWebhookInbox.findUnique.mockResolvedValue({ attemptCount: 5 });
    prisma.kycWebhookInbox.update.mockResolvedValue({});

    await service.fail('event-1', 'processor unavailable');

    expect(prisma.kycWebhookInbox.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        status: 'FAILED',
        claimedAt: null,
        lastError: 'processor unavailable',
        nextAttemptAt: null,
        processedAt: expect.any(Date),
      },
    });
  });

  it('recovers stale processing claims for another worker', async () => {
    prisma.kycWebhookInbox.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.recoverStaleClaims(300)).resolves.toBe(2);

    expect(prisma.kycWebhookInbox.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PROCESSING',
        claimedAt: { lt: expect.any(Date) },
      },
      data: {
        status: 'RECEIVED',
        claimedAt: null,
        nextAttemptAt: expect.any(Date),
        lastError: 'Recovered stale KYC webhook claim',
      },
    });
  });
});
