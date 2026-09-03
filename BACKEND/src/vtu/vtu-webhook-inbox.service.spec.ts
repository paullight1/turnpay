import { Prisma } from '@prisma/client';
import { VtuWebhookInboxService } from './vtu-webhook-inbox.service';

describe('VtuWebhookInboxService', () => {
  const prisma = {
    vtuWebhookInbox: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const event = {
    eventType: 'transaction-update',
    providerRequestId: 'REQ-1',
    providerReference: 'TX-1',
    status: 'success' as const,
    message: 'TRANSACTION DELIVERED',
    code: '000',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records one redacted durable inbox row for a callback', async () => {
    prisma.vtuWebhookInbox.create.mockResolvedValue({ id: 'inbox-1' });
    const service = new VtuWebhookInboxService(prisma as any, logger as any);

    const result = await service.record(event);

    expect(result).toEqual({ duplicate: false, inboxId: 'inbox-1' });
    expect(prisma.vtuWebhookInbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        eventType: 'transaction-update',
        providerRequestId: 'REQ-1',
        providerTransactionId: 'TX-1',
        providerStatus: 'success',
        payload: {
          code: '000',
          message: 'TRANSACTION DELIVERED',
        },
      }),
    });
  });

  it('treats the unique event key as an idempotent replay', async () => {
    prisma.vtuWebhookInbox.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const service = new VtuWebhookInboxService(prisma as any, logger as any);

    await expect(service.record(event)).resolves.toEqual({
      duplicate: true,
    });
  });

  it('claims and marks a due callback processed exactly once', async () => {
    const row = {
      id: 'inbox-1',
      attempts: 0,
      processedAt: null,
      eventType: event.eventType,
      providerRequestId: event.providerRequestId,
      providerTransactionId: event.providerReference,
      providerStatus: event.status,
      payload: { code: event.code, message: event.message },
    };
    prisma.vtuWebhookInbox.findUnique.mockResolvedValue(row);
    prisma.vtuWebhookInbox.updateMany.mockResolvedValue({ count: 1 });
    prisma.vtuWebhookInbox.update.mockResolvedValue({});
    const processor = jest.fn().mockResolvedValue(undefined);
    const service = new VtuWebhookInboxService(prisma as any, logger as any);

    await expect(service.process('inbox-1', processor)).resolves.toEqual({
      processed: true,
    });
    expect(processor).toHaveBeenCalledWith(event);
    expect(prisma.vtuWebhookInbox.update).toHaveBeenCalledWith({
      where: { id: 'inbox-1' },
      data: expect.objectContaining({ processedAt: expect.any(Date) }),
    });
  });

  it('does not process a callback another worker already claimed', async () => {
    prisma.vtuWebhookInbox.findUnique.mockResolvedValue({
      id: 'inbox-1',
      attempts: 0,
      processedAt: null,
    });
    prisma.vtuWebhookInbox.updateMany.mockResolvedValue({ count: 0 });
    const processor = jest.fn();
    const service = new VtuWebhookInboxService(prisma as any, logger as any);

    await expect(service.process('inbox-1', processor)).resolves.toEqual({
      processed: false,
    });
    expect(processor).not.toHaveBeenCalled();
  });

  it('retries due callbacks and leaves exhausted callbacks in the dead-letter set', async () => {
    prisma.vtuWebhookInbox.findMany.mockResolvedValue([
      { id: 'inbox-1' },
      { id: 'inbox-2' },
    ]);
    const service = new VtuWebhookInboxService(prisma as any, logger as any);
    jest.spyOn(service, 'process').mockResolvedValue({ processed: true });
    const processor = jest.fn();

    await expect(service.retryPending(processor, 10)).resolves.toEqual({
      checked: 2,
      processed: 2,
      failed: 0,
    });
    expect(prisma.vtuWebhookInbox.findMany).toHaveBeenCalledWith({
      where: {
        processedAt: null,
        nextAttemptAt: { lte: expect.any(Date) },
        attempts: { lt: 12 },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 10,
      select: { id: true },
    });
  });
});
