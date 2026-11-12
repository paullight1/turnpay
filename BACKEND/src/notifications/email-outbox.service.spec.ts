import {
  EmailOutboxSettings,
  EmailTransport,
  TransactionalEmailOutboxService,
} from './email-outbox.service';
import { EmailRecipientVerifier } from './email-recipient-verifier';
import { Decimal } from '@prisma/client/runtime/library';

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

function makeRecipientVerifier(
  result: Awaited<ReturnType<EmailRecipientVerifier['verify']>> = {
    verified: true,
  },
): EmailRecipientVerifier {
  return { verify: jest.fn().mockResolvedValue(result) };
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
    createdAt: new Date('2026-11-03T10:00:00.000Z'),
    claimedAt: null,
    claimToken: null,
    user: { email: 'ada@example.com' },
    ...overrides,
  };
}

function makePrisma(rows = [makeRow()]) {
  const state: Array<Record<string, any>> = [...rows];
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
        const cutoverMatches = where.createdAt?.gte
          ? row.createdAt >= where.createdAt.gte
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
          cutoverMatches &&
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
          const cutoverMatches = where.createdAt?.gte
            ? row.createdAt >= where.createdAt.gte
            : true;
          const tokenMatches = where.claimToken
            ? row.claimToken === where.claimToken
            : true;
          return statusMatches && dueMatches && cutoverMatches && tokenMatches;
        })
        .slice(0, take ?? state.length)
        .map((row) => ({ ...row }));
    }),
  };
  return {
    emailOutbox,
    ledgerEntry: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    transaction: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
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
      makeRecipientVerifier(),
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

  it.each([
    [
      'unconfirmed',
      {
        verified: false,
        code: 'recipient_unconfirmed',
        retryable: true,
      },
    ],
    [
      'mismatched',
      {
        verified: false,
        code: 'recipient_email_mismatch',
        retryable: true,
      },
    ],
    [
      'provider failure',
      {
        verified: false,
        code: 'recipient_identity_unavailable',
        retryable: true,
      },
    ],
  ])('does not send when the recipient is %s', async (_label, result) => {
    const prisma = makePrisma();
    const send = jest.fn();
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      { send },
      makeLogger() as never,
      makeRecipientVerifier(result as never),
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(send).not.toHaveBeenCalled();
    expect(prisma.state[0]).toMatchObject({
      status: 'FAILED',
      lastErrorCode: result.code,
      claimToken: null,
      claimedAt: null,
    });
  });

  it('fails closed when recipient verification exceeds its deadline', async () => {
    jest.useFakeTimers();
    try {
      const prisma = makePrisma();
      const send = jest.fn();
      const verifier: EmailRecipientVerifier = {
        verify: jest.fn(() => new Promise(() => undefined)),
      };
      const service = new TransactionalEmailOutboxService(
        prisma as never,
        makeSettings(),
        { send },
        makeLogger() as never,
        verifier,
      );

      const dispatch = service.dispatchPendingEmails(
        new Date('2026-11-03T10:00:00.000Z'),
      );
      await jest.advanceTimersByTimeAsync(10_000);
      await dispatch;

      expect(send).not.toHaveBeenCalled();
      expect(prisma.state[0]).toMatchObject({
        status: 'FAILED',
        lastErrorCode: 'recipient_identity_unavailable',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders a wallet movement from the immutable ledger snapshot rather than a live wallet balance', async () => {
    const prisma = makePrisma([
      makeRow({
        eventKey: 'wallet:movement:ledger-1',
        eventType: 'WALLET_CREDIT',
        orderId: 'ledger-1',
      }),
    ]);
    prisma.ledgerEntry.findUnique.mockResolvedValue({
      id: 'ledger-1',
      amount: new Decimal('12.50'),
      balanceAfter: new Decimal('112.50'),
      currency: 'NGN',
      direction: 'CREDIT',
      reference: 'KORA-1',
      source: 'KORA_DEPOSIT',
      createdAt: new Date('2026-11-03T09:59:00.000Z'),
      wallet: { userId: 'user-1' },
      transaction: {
        userId: 'user-1',
        type: 'FUND',
        status: 'SUCCESS',
      },
    });
    const transport: EmailTransport = {
      send: jest.fn().mockResolvedValue({ status: 'SENT' }),
    };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
      makeRecipientVerifier(),
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    const message = (transport.send as jest.Mock).mock.calls[0][0];
    expect(message.text).toContain('NGN 12.50');
    expect(message.text).toContain('NGN 112.50');
    expect(message.text).not.toContain('999.99');
    expect(prisma.ledgerEntry.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ledger-1' } }),
    );
  });

  it('enriches the established deposit confirmation with its original ledger amount and balance snapshot', async () => {
    const prisma = makePrisma([
      makeRow({
        eventKey: 'wallet:deposit-received:tx-deposit-1',
        eventType: 'DEPOSIT_RECEIVED',
        orderId: 'tx-deposit-1',
      }),
    ]);
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-deposit-1',
      userId: 'user-1',
      amount: new Decimal('50.00'),
      currency: 'NGN',
      reference: 'PAY-1',
      status: 'SUCCESS',
      type: 'FUND',
      ledgerEntries: [
        {
          amount: new Decimal('50.00'),
          balanceAfter: new Decimal('150.00'),
          currency: 'NGN',
          direction: 'CREDIT',
          reference: 'PAY-1',
          source: 'PAYSTACK_CHECKOUT',
          wallet: { userId: 'user-1' },
        },
      ],
    });
    const transport: EmailTransport = {
      send: jest.fn().mockResolvedValue({ status: 'SENT' }),
    };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
      makeRecipientVerifier(),
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    const message = (transport.send as jest.Mock).mock.calls[0][0];
    expect(message.subject).toBe('Your TrustPay deposit is confirmed');
    expect(message.text).toContain('NGN 50.00');
    expect(message.text).toContain('NGN 150.00');
  });

  it('exhausts a wallet movement whose ledger ownership does not match the outbox user', async () => {
    const prisma = makePrisma([
      makeRow({
        eventKey: 'wallet:movement:ledger-2',
        eventType: 'WALLET_DEBIT',
        orderId: 'ledger-2',
      }),
    ]);
    prisma.ledgerEntry.findUnique.mockResolvedValue({
      id: 'ledger-2',
      amount: new Decimal('5.00'),
      balanceAfter: new Decimal('95.00'),
      currency: 'NGN',
      direction: 'DEBIT',
      reference: 'WD-2',
      source: 'WITHDRAWAL',
      wallet: { userId: 'different-user' },
      transaction: {
        userId: 'different-user',
        type: 'WITHDRAW',
        status: 'PENDING',
      },
    });
    const send = jest.fn();
    const transport: EmailTransport = { send };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
      makeRecipientVerifier(),
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(send).not.toHaveBeenCalled();
    expect(prisma.state[0]).toMatchObject({
      status: 'EXHAUSTED',
      lastErrorCode: 'ledger_ownership_mismatch',
    });
  });

  it('does not send a stale terminal success event after the transaction status changes', async () => {
    const prisma = makePrisma([
      makeRow({
        eventKey: 'transaction:status:tx-3:SUCCESS',
        eventType: 'TRANSACTION_SUCCESS',
        orderId: 'tx-3',
      }),
    ]);
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-3',
      userId: 'user-1',
      amount: new Decimal('25.00'),
      currency: 'NGN',
      reference: 'VTU-3',
      status: 'REVERSED',
      type: 'AIRTIME',
    });
    const send = jest.fn();
    const transport: EmailTransport = { send };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
      makeRecipientVerifier(),
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(send).not.toHaveBeenCalled();
    expect(prisma.state[0]).toMatchObject({
      status: 'UNKNOWN',
      lastErrorCode: 'transaction_status_changed',
    });
  });

  it('schedules a retry when the immutable financial snapshot lookup fails before sending', async () => {
    const prisma = makePrisma([
      makeRow({
        eventKey: 'wallet:movement:ledger-render-error',
        eventType: 'WALLET_CREDIT',
        orderId: 'ledger-render-error',
      }),
    ]);
    prisma.ledgerEntry.findUnique.mockRejectedValueOnce(
      new Error('database temporarily unavailable'),
    );
    const send = jest.fn();
    const transport: EmailTransport = { send };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings({ retryBaseSeconds: 30 }),
      transport,
      makeLogger() as never,
      makeRecipientVerifier(),
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(send).not.toHaveBeenCalled();
    expect(prisma.state[0]).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'render_error',
      nextAttemptAt: new Date('2026-11-03T10:00:30.000Z'),
      claimToken: null,
      claimedAt: null,
    });
  });

  it('does not claim historical pending rows before the configured cutover', async () => {
    const prisma = makePrisma([
      makeRow({
        createdAt: new Date('2026-11-02T10:00:00.000Z'),
      }),
    ]);
    const send = jest.fn();
    const transport: EmailTransport = { send };
    const service = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings({ notBefore: new Date('2026-11-03T00:00:00.000Z') }),
      transport,
      makeLogger() as never,
      makeRecipientVerifier(),
    );

    await service.dispatchPendingEmails(new Date('2026-11-03T10:00:00.000Z'));

    expect(send).not.toHaveBeenCalled();
    expect(prisma.state[0]).toMatchObject({
      status: 'PENDING',
      attemptCount: 0,
    });
    expect(prisma.emailOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: new Date('2026-11-03T00:00:00.000Z') },
        }),
      }),
    );
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
      makeRecipientVerifier(),
    );
    const second = new TransactionalEmailOutboxService(
      prisma as never,
      makeSettings(),
      transport,
      makeLogger() as never,
      makeRecipientVerifier(),
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
      makeRecipientVerifier(),
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
      makeRecipientVerifier(),
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
      makeRecipientVerifier(),
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
      makeRecipientVerifier(),
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
      makeRecipientVerifier(),
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
      makeRecipientVerifier(),
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
