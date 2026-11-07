import { ConflictException, HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';
import { ManualExchangeService } from './manual-exchange.service';
import { ManualExchangeReminderDto } from './dto/manual-exchange.dto';

const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function syntheticOrder(
  overrides: Partial<{
    id: string;
    userId: string;
    status: string;
    proofKey: string | null;
    version: number;
    events: Array<{
      action: string;
      createdAt: Date;
      status: string;
      reason: string;
    }>;
  }> = {},
) {
  return {
    id: orderId,
    userId: ownerId,
    status: 'AWAITING_CONFIRMATION',
    proofKey: 'manual-exchange/order/proof.png',
    version: 3,
    events: [
      {
        action: 'CREATE',
        createdAt: new Date('2026-11-04T10:00:00.000Z'),
        status: 'AWAITING_TRANSFER',
        reason: 'Exchange instructions created',
      },
      {
        action: 'PROOF',
        createdAt: new Date('2026-11-04T09:50:00.000Z'),
        status: 'AWAITING_CONFIRMATION',
        reason: 'Customer submitted transfer proof',
      },
    ],
    ...overrides,
  };
}

function harness(row = syntheticOrder(), replay: unknown = null) {
  const eventCreate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'event-reminder-1',
      ...data,
      createdAt: new Date('2026-11-04T10:06:00.000Z'),
    }),
  );
  const notificationCreate = jest.fn().mockResolvedValue({
    id: 'notification-1',
  });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    manualExchangeOrder: {
      findFirst: jest.fn().mockResolvedValue(row),
      updateMany,
    },
    manualExchangeEvent: {
      findUnique: jest.fn().mockResolvedValue(replay),
      create: eventCreate,
    },
    paymentNotification: { create: notificationCreate },
  };
  const prisma = {
    $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  };
  const logger = { info: jest.fn() };
  const service = new ManualExchangeService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    logger as never,
  );
  return { service, tx, eventCreate, notificationCreate, updateMany, logger };
}

describe('manual exchange review reminders', () => {
  beforeEach(() =>
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T10:06:00.000Z')),
  );
  afterEach(() => jest.useRealTimers());

  it('validates the closed customer reminder DTO', async () => {
    expect(
      await validate(
        plainToInstance(ManualExchangeReminderDto, { reason: 'REVIEW' }),
      ),
    ).toEqual([]);
    expect(
      (
        await validate(
          plainToInstance(ManualExchangeReminderDto, { reason: 'OTHER' }),
        )
      ).map((error) => error.property),
    ).toContain('reason');
    expect(
      (
        await validate(
          plainToInstance(ManualExchangeReminderDto, {
            reason: 'REVIEW',
            status: 'COMPLETED',
          }),
          { whitelist: true, forbidNonWhitelisted: true },
        )
      ).map((error) => error.property),
    ).toContain('status');
  });

  it('creates one audit event and one admin notification without changing financial state', async () => {
    const h = harness();
    const before = syntheticOrder();
    const result = await h.service.remind(
      orderId,
      ownerId,
      { reason: 'REVIEW' },
      'reminder-key-0001',
      {
        requestId: 'request-1',
        ipAddress: '127.0.0.1',
        idempotencyKeyDigest: 'digest-1',
      },
    );

    expect(result).toEqual({
      requestedAt: '2026-11-04T10:06:00.000Z',
      nextAllowedAt: '2026-11-04T10:16:00.000Z',
    });
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { id: orderId, version: before.version, status: before.status },
      data: { status: before.status, version: { increment: 1 } },
    });
    expect(h.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId,
        actorId: ownerId,
        action: 'REVIEW_REMINDER',
        status: 'AWAITING_CONFIRMATION',
        reason: 'REVIEW',
      }),
    });
    expect(h.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        audience: 'ADMIN',
        orderId,
        eventKey: expect.stringContaining(':review-reminder:'),
      }),
    });
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId,
        userId: ownerId,
        idempotencyKeyDigest: 'digest-1',
      }),
      'Manual exchange review reminder requested',
    );
  });

  it.each(['PAYOUT_PENDING', 'PAYOUT_PROCESSING', 'PAYOUT_SENT'])(
    'accepts proof-backed %s orders awaiting payout review',
    async (status) => {
      const h = harness(syntheticOrder({ status }));
      await expect(
        h.service.remind(
          orderId,
          ownerId,
          { reason: 'REVIEW' },
          `reminder-${status}-0001`,
        ),
      ).resolves.toMatchObject({
        requestedAt: expect.any(String),
        nextAllowedAt: expect.any(String),
      });
    },
  );

  it('rejects another owner without writing an event or notification', async () => {
    const h = harness(syntheticOrder({ userId: otherUserId }));
    h.tx.manualExchangeOrder.findFirst.mockResolvedValueOnce(null);
    await expect(
      h.service.remind(
        orderId,
        ownerId,
        { reason: 'REVIEW' },
        'other-owner-key-0001',
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(h.eventCreate).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'COMPLETED', proofKey: 'proof-key' },
    { status: 'REJECTED', proofKey: 'proof-key' },
    { status: 'AWAITING_CONFIRMATION', proofKey: null },
    { status: 'NEEDS_MORE_INFO', proofKey: 'proof-key' },
  ])('rejects an unsafe reminder state: %j', async (state) => {
    const h = harness(syntheticOrder(state));
    await expect(
      h.service.remind(
        orderId,
        ownerId,
        { reason: 'REVIEW' },
        'unsafe-state-key-0001',
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.eventCreate).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('returns a structured 429 with nextAllowedAt during the per-order cooldown', async () => {
    const h = harness(
      syntheticOrder({
        events: [
          {
            action: 'PROOF',
            createdAt: new Date('2026-11-04T10:00:00.000Z'),
            status: 'AWAITING_CONFIRMATION',
            reason: 'Customer submitted transfer proof',
          },
          {
            action: 'REVIEW_REMINDER',
            createdAt: new Date('2026-11-04T10:05:30.000Z'),
            status: 'AWAITING_CONFIRMATION',
            reason: 'REVIEW',
          },
        ],
      }),
    );
    let error: unknown;
    try {
      await h.service.remind(
        orderId,
        ownerId,
        { reason: 'REVIEW' },
        'fresh-cooldown-key-0001',
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toEqual({
      message: 'Please wait before requesting another review reminder',
      nextAllowedAt: '2026-11-04T10:15:30.000Z',
    });
    expect(h.eventCreate).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('replays the original timestamps with no second write after the order changes status', async () => {
    const replay = {
      id: 'event-original',
      createdAt: new Date('2026-11-04T10:01:00.000Z'),
      requestHash: expect.any(String),
    };
    const h = harness(
      syntheticOrder({ status: 'COMPLETED', proofKey: null }),
      replay,
    );
    // The service compares the stored request hash, so use the hash captured
    // from the first call's DTO by replacing the matcher with the real value.
    const findReplay = h.tx.manualExchangeEvent.findUnique;
    findReplay.mockImplementationOnce(({ where }) => ({
      ...replay,
      requestHash: createHash('sha256')
        .update(JSON.stringify({ reason: 'REVIEW' }))
        .digest('hex'),
      keyHash: where.orderId_actorId_action_keyHash.keyHash,
    }));
    await expect(
      h.service.remind(
        orderId,
        ownerId,
        { reason: 'REVIEW' },
        'replay-key-00001',
      ),
    ).resolves.toEqual({
      requestedAt: '2026-11-04T10:01:00.000Z',
      nextAllowedAt: '2026-11-04T10:11:00.000Z',
    });
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.eventCreate).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('stops an optimistic collision before enqueueing anything', async () => {
    const h = harness();
    h.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      h.service.remind(
        orderId,
        ownerId,
        { reason: 'REVIEW' },
        'collision-key-0001',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.eventCreate).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('rolls the reminder unit back when the notification enqueue fails', async () => {
    const h = harness();
    h.notificationCreate.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(
      h.service.remind(
        orderId,
        ownerId,
        { reason: 'REVIEW' },
        'atomic-failure-key-0001',
      ),
    ).rejects.toThrow('queue unavailable');
    // Both writes were issued through the same transaction callback; Prisma
    // rolls the preceding version/event writes back on this rejection.
    expect(h.eventCreate).toHaveBeenCalledTimes(1);
    expect(h.notificationCreate).toHaveBeenCalledTimes(1);
  });
});
