import {
  EmailOutboxSettings,
  EmailTransport,
  TransactionalEmailOutboxService,
} from './email-outbox.service';

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeSettings(
  overrides: Partial<EmailOutboxSettings> = {},
): EmailOutboxSettings {
  return {
    provider: 'resend',
    enabled: true,
    from: 'TrustPay <no-reply@example.com>',
    batchSize: 25,
    leaseSeconds: 300,
    retryBaseSeconds: 60,
    maxAttempts: 5,
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-1',
    userId: 'user-1',
    eventKey: 'kyc:bvn-verified:verification-1',
    eventType: 'BVN_VERIFIED',
    orderId: 'verification-1',
    status: 'PENDING',
    attemptCount: 0,
    nextAttemptAt: new Date('2026-11-03T10:00:00.000Z'),
    claimedAt: null,
    claimToken: null,
    user: { email: 'ada@example.com' },
    ...overrides,
  };
}

function makePrisma(rows = [makeRow()]) {
  const state = [...rows];
  const emailOutbox = {
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of state) {
        const statusMatches = where.status?.in
          ? where.status.in.includes(row.status)
          : !where.status || row.status === where.status;
        const idMatches = where.id?.in ? where.id.in.includes(row.id) : true;
        const dueMatches = where.nextAttemptAt?.lte
          ? row.nextAttemptAt <= where.nextAttemptAt.lte
          : true;
        const tokenMatches = where.claimToken
          ? row.claimToken === where.claimToken
          : true;
        const staleMatches = where.claimedAt?.lt
          ? row.claimedAt && row.claimedAt < where.claimedAt.lt
          : true;
        if (
          statusMatches &&
          idMatches &&
          dueMatches &&
          tokenMatches &&
          staleMatches
        ) {
          Object.entries(data).forEach(([key, value]) => {
            if (typeof value === 'object' && value && 'increment' in value) {
              row[key] += Number((value as { increment: number }).increment);
            } else {
              row[key] = value;
            }
          });
          count += 1;
        }
      }
      return { count };
    }),
    findMany: jest.fn(async ({ where, take }: any) => {
      return state
        .filter((row) => {
          const statusMatches = where.status?.in
            ? where.status.in.includes(row.status)
            : !where.status || row.status === where.status;
          const dueMatches = where.nextAttemptAt?.lte
            ? row.nextAttemptAt <= where.nextAttemptAt.lte
            : true;
          const tokenMatches = where.claimToken
            ? row.claimToken === where.claimToken
            : true;
          return statusMatches && dueMatches && tokenMatches;
        })
        .slice(0, take ?? state.length)
        .map((row) => ({ ...row }));
    }),
  };
  return {
    emailOutbox,
    state,
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
      callback({ emailOutbox }),
    ),
  };
}

describe('TransactionalEmailOutboxService', () => {
  it('sends a claimed event using the current user email and privacy-safe static content', async () => {
    const prisma = makePrisma();
    const send = jest.fn().mockResolvedValue({
      status: 'SENT',
      providerMessageId: 'provider-message-1',
    });
    const transport: EmailTransport = {
      send,
    };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(send).toHaveBeenCalledWith({
      idempotencyKey: 'outbox-1',
      from: 'TrustPay <no-reply@example.com>',
      to: 'ada@example.com',
      subject: 'Your BVN is verified',
      text: expect.not.stringContaining('verification-1'),
      html: expect.not.stringContaining('verification-1'),
    });
    const message = send.mock.calls[0][0];
    expect(message.text).not.toContain('user-1');
    expect(message.html).not.toContain('account-1');
    expect(prisma.state[0]).toMatchObject({
      status: 'SENT',
      providerMessageId: 'provider-message-1',
      claimToken: null,
      claimedAt: null,
    });
  });

  it('uses the conditional lease claim so concurrent workers send once', async () => {
    const prisma = makePrisma();
    const transport: EmailTransport = {
      send: jest.fn().mockResolvedValue({ status: 'SENT' }),
    };
    const first = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
    );
    const second = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
    );

    await Promise.all([
      first.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z')),
      second.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z')),
    ]);

    expect((transport.send as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('caps a short-lease claim below the configured batch size', async () => {
    const prisma = makePrisma();
    const transport: EmailTransport = {
      send: jest.fn().mockResolvedValue({ status: 'SENT' }),
    };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings({ batchSize: 25, leaseSeconds: 60 }),
      transport,
      makeLogger() as never,
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(prisma.emailOutbox.findMany.mock.calls[0][0].take).toBe(10);
  });

  it('marks confirmed failures for a bounded retry without retrying in the same run', async () => {
    const prisma = makePrisma();
    const transport: EmailTransport = {
      send: jest.fn().mockResolvedValue({
        status: 'FAILED',
        code: 'http_429',
        retryable: true,
      }),
    };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings({ retryBaseSeconds: 30 }),
      transport,
      makeLogger() as never,
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(prisma.state[0]).toMatchObject({
      status: 'FAILED',
      claimToken: null,
    });
    expect(prisma.state[0].nextAttemptAt).toEqual(
      new Date('2026-11-03T10:00:30.000Z'),
    );
    expect((transport.send as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('exhausts permanent provider failures without scheduling another retry', async () => {
    const prisma = makePrisma();
    const transport: EmailTransport = {
      send: jest.fn().mockResolvedValue({
        status: 'FAILED',
        code: 'http_401',
        retryable: false,
      }),
    };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(prisma.state[0]).toMatchObject({
      status: 'EXHAUSTED',
      lastErrorCode: 'http_401',
      nextAttemptAt: new Date('2026-11-03T10:00:00.000Z'),
    });
  });

  it('persists ambiguous transport outcomes as terminal unknown', async () => {
    const prisma = makePrisma();
    const transport: EmailTransport = {
      send: jest
        .fn()
        .mockResolvedValue({ status: 'UNKNOWN', code: 'network_error' }),
    };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(prisma.state[0]).toMatchObject({
      status: 'UNKNOWN',
      lastErrorCode: 'network_error',
      claimToken: null,
      claimedAt: null,
    });
  });

  it('marks stale in-flight claims unknown instead of automatically resending', async () => {
    const stale = makeRow({
      status: 'IN_FLIGHT',
      claimedAt: new Date('2026-11-03T09:00:00.000Z'),
      claimToken: 'old-claim',
    });
    const prisma = makePrisma([stale]);
    const transport: EmailTransport = { send: jest.fn() };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings({ leaseSeconds: 300 }),
      transport,
      makeLogger() as never,
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect((transport.send as jest.Mock).mock.calls).toHaveLength(0);
    expect(prisma.state[0]).toMatchObject({
      status: 'UNKNOWN',
      lastErrorCode: 'stale_lease',
    });
  });

  it('leaves pending rows untouched when transactional email delivery is disabled', async () => {
    const prisma = makePrisma();
    const transport: EmailTransport = { send: jest.fn() };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings({ provider: 'disabled', enabled: false }),
      transport,
      makeLogger() as never,
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect((transport.send as jest.Mock).mock.calls).toHaveLength(0);
    expect(prisma.emailOutbox.updateMany).not.toHaveBeenCalled();
    expect(prisma.state[0]).toMatchObject({
      status: 'PENDING',
      attemptCount: 0,
    });
  });
});
