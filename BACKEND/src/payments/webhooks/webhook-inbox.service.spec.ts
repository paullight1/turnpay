import { Prisma } from '@prisma/client';
import { WebhookInboxService } from './webhook-inbox.service';

describe('WebhookInboxService', () => {
  const prisma = {
    paymentWebhookInbox: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  let service: WebhookInboxService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookInboxService(prisma as any, logger as any);
  });

  it('returns the existing event id when the same provider event is retried', async () => {
    prisma.paymentWebhookInbox.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        clientVersion: '6.19.3',
        code: 'P2002',
      }),
    );
    prisma.paymentWebhookInbox.findFirst.mockResolvedValue({
      id: 'evt-1',
    });

    const result = await service.accept({
      provider: 'MONNIFY',
      eventType: 'SUCCESSFUL_TRANSACTION',
      providerReference: 'ref-1',
      payload: {
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: {
          transactionReference: 'ref-1',
        },
      },
    });

    expect(result).toEqual({ eventId: 'evt-1', duplicate: true });
  });

  it('claims newly received events once', async () => {
    prisma.paymentWebhookInbox.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.claim('evt-2')).resolves.toBe(true);
    expect(prisma.paymentWebhookInbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'evt-2',
        OR: [
          { status: 'RECEIVED' },
          {
            status: 'FAILED',
            nextAttemptAt: { lte: expect.any(Date) },
          },
        ],
      },
      data: {
        status: 'PROCESSING',
        claimedAt: expect.any(Date),
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
  });

  it('returns stale processing events to received for retry', async () => {
    prisma.paymentWebhookInbox.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.recoverStaleClaims(300)).resolves.toBe(3);

    expect(prisma.paymentWebhookInbox.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PROCESSING',
        claimedAt: { lt: expect.any(Date) },
      },
      data: {
        status: 'RECEIVED',
        claimedAt: null,
        nextAttemptAt: expect.any(Date),
        lastError: 'Recovered stale webhook claim',
      },
    });
  });
});
