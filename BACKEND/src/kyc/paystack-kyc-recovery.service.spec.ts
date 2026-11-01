import { ServiceUnavailableException } from '@nestjs/common';
import { PaystackKycRecoveryService } from './paystack-kyc-recovery.service';
import {
  PaystackKycRecoveryView,
  toPaystackRecoveryView,
} from './paystack-kyc-recovery.types';

type MutableVerification = {
  id: string;
  userId: string;
  documentId: string;
  provider: 'PAYSTACK';
  status: 'PENDING' | 'VERIFIED';
  reference: string;
  checks: Record<string, unknown>;
  createdAt: Date;
  consentRecordedAt?: Date;
  document: { id: string; type: 'BVN' };
};

const pendingSince = new Date('2026-10-31T04:31:00.000Z');

function makeState(overrides: Partial<MutableVerification> = {}) {
  const verification: MutableVerification = {
    id: 'verification-1',
    userId: 'user-1',
    documentId: 'document-1',
    provider: 'PAYSTACK',
    status: 'PENDING',
    reference: 'paystack:customer:CUS_123:verification:document-1',
    checks: {
      customerCode: 'CUS_123',
      validationFingerprint: 'fingerprint-1',
    },
    createdAt: pendingSince,
    document: { id: 'document-1', type: 'BVN' },
    ...overrides,
  };

  return {
    customer: {
      userId: 'user-1',
      customerCode: 'CUS_123',
      customerId: '456',
      validationStatus: 'PENDING',
      validationFingerprint: 'fingerprint-1',
    },
    verification,
  };
}

function makeHarness(
  overrides: Partial<MutableVerification> = {},
  customerOverrides: Record<string, unknown> = {},
) {
  const state = makeState(overrides);
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    ),
    paystackCustomer: {
      findUnique: jest.fn().mockResolvedValue(state.customer),
    },
    kycVerification: {
      findFirst: jest
        .fn()
        .mockImplementation(async () =>
          state.verification.status === 'PENDING' ? state.verification : null,
        ),
      findUnique: jest.fn().mockImplementation(async () => state.verification),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        if (
          where.id !== state.verification.id ||
          (where.status && where.status !== state.verification.status)
        ) {
          return { count: 0 };
        }
        state.verification = {
          ...state.verification,
          ...data,
          checks: data.checks ?? state.verification.checks,
        };
        return { count: 1 };
      }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
  const paystack = {
    request: jest.fn(),
    page: jest.fn().mockResolvedValue({ data: [], meta: { next: null } }),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'PAYSTACK_SECRET_KEY') return 'sk_live_fixture';
      return fallback;
    }),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  paystack.request.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/customer/CUS_123') {
      return {
        customer_code: 'CUS_123',
        id: 456,
        domain: 'live',
        identified: false,
        identifications: null,
        ...customerOverrides,
      };
    }
    throw new Error(`unexpected provider request: ${method} ${path}`);
  });

  const service = new PaystackKycRecoveryService(
    prisma as never,
    paystack as never,
    config as never,
    logger as never,
  );

  return { service, prisma, paystack, logger, state };
}

describe('PaystackKycRecoveryService', () => {
  afterEach(() => jest.useRealTimers());

  it('projects an unresolved attempt older than 24 hours as action required', () => {
    const result = toPaystackRecoveryView(
      'document-1',
      new Date('2026-10-30T00:00:00.000Z'),
      { state: 'AWAITING_PROVIDER', checkedAt: '2026-10-31T00:00:00.000Z' },
    );

    expect(result).toEqual<PaystackKycRecoveryView>({
      state: 'ACTION_REQUIRED',
      message: expect.any(String),
      supportReference: 'KYC-document-1',
      pendingSince: '2026-10-30T00:00:00.000Z',
      checkedAt: '2026-10-31T00:00:00.000Z',
      retryAllowed: false,
    });
  });

  it.each([
    ['prior generation', { createdAt: '2026-10-31T05:00:00Z' }],
    ['future event', { createdAt: '2099-01-01T00:00:00Z' }],
    ['missing event id', { _id: undefined }],
    [
      'missing customer id',
      {
        event_payload: {
          event: 'customeridentification.failed',
          data: { customer_code: 'CUS_123' },
        },
      },
    ],
    ['wrong category binding', { category_row_id: 999 }],
  ])(
    'refuses replay with %s even when the list filter returns it',
    async (_label, overrides) => {
      const { service, paystack } = makeHarness({
        consentRecordedAt: new Date('2026-10-31T10:00:00Z'),
      });
      jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00Z'));
      paystack.page.mockResolvedValue({
        data: [
          {
            _id: 'event-invalid',
            domain: 'live',
            event_name: 'customeridentification.failed',
            category: 'customers',
            category_row_id: 456,
          },
        ],
      });
      paystack.request.mockImplementation(
        async (method: string, path: string) => {
          if (method === 'POST') return { count: 1, failed: 0, failed_ids: [] };
          if (path.startsWith('/customer/'))
            return {
              id: 456,
              customer_code: 'CUS_123',
              domain: 'live',
              identified: false,
            };
          return {
            _id: 'event-invalid',
            domain: 'live',
            category: 'customers',
            category_row_id: 456,
            event_name: 'customeridentification.failed',
            createdAt: '2026-10-31T10:01:00Z',
            event_payload: {
              event: 'customeridentification.failed',
              data: { customer_code: 'CUS_123', customer_id: 456 },
            },
            ...overrides,
          };
        },
      );
      await service.reconcile('user-1');
      expect(
        paystack.request.mock.calls.filter(([method]) => method === 'POST'),
      ).toHaveLength(0);
    },
  );

  it('returns no-pending without contacting Paystack', async () => {
    const { service, prisma, paystack } = makeHarness({ status: 'VERIFIED' });

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('NO_PENDING');
    expect(result.retryAllowed).toBe(false);
    expect(paystack.request).not.toHaveBeenCalled();
    expect(paystack.page).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails closed for a foreign provider customer without replaying events', async () => {
    const { service, paystack } = makeHarness(
      {},
      { customer_code: 'CUS_other' },
    );

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('ACTION_REQUIRED');
    expect(result.retryAllowed).toBe(false);
    expect(paystack.page).not.toHaveBeenCalled();
    expect(paystack.request).toHaveBeenCalledTimes(1);
    expect(paystack.request).not.toHaveBeenCalledWith(
      'POST',
      '/integration/webhooks/events/resend',
      expect.anything(),
    );
  });

  it('leaves an unidentified customer awaiting the provider when no terminal event exists', async () => {
    const { service, prisma, paystack, state } = makeHarness();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00.000Z'));

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('AWAITING_PROVIDER');
    expect(result.pendingSince).toBe(pendingSince.toISOString());
    expect(result.supportReference).toBe('KYC-document-1');
    expect(result.retryAllowed).toBe(false);
    expect(paystack.page).toHaveBeenCalledWith(
      '/integration/webhooks/events',
      expect.objectContaining({
        category_row_id: '456',
        from: pendingSince.toISOString(),
        limit: '25',
      }),
    );
    expect(paystack.request).not.toHaveBeenCalledWith(
      'POST',
      '/integration/webhooks/events/resend',
      expect.anything(),
    );
    const persistedChecks = state.verification.checks
      .paystackRecovery as Record<string, unknown>;
    expect(persistedChecks.state).toBe('AWAITING_PROVIDER');
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      'identifications',
    );
  });

  it('reserves and requests exactly one genuine matching terminal event', async () => {
    const { service, paystack, state } = makeHarness();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00.000Z'));
    paystack.page.mockResolvedValue({
      data: [
        {
          _id: 'event-1',
          event_name: 'customeridentification.success',
          category: 'customers',
          category_row_id: 456,
          domain: 'live',
        },
      ],
      meta: { next: null },
    });
    paystack.request
      .mockResolvedValueOnce({
        customer_code: 'CUS_123',
        id: 456,
        domain: 'live',
        identified: false,
        identifications: null,
      })
      .mockResolvedValueOnce({
        _id: 'event-1',
        domain: 'live',
        category: 'customers',
        category_row_id: 456,
        event_name: 'customeridentification.success',
        createdAt: '2026-10-31T04:32:00Z',
        event_payload: {
          event: 'customeridentification.success',
          data: { customer_code: 'CUS_123', customer_id: 456 },
        },
      })
      .mockResolvedValueOnce({ count: 1, failed: 0, failed_ids: [] });

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('WEBHOOK_REQUESTED');
    expect(paystack.request).toHaveBeenNthCalledWith(
      3,
      'POST',
      '/integration/webhooks/events/resend',
      { ids: ['event-1'] },
    );
    expect(state.verification.status).toBe('PENDING');
    const recovery = state.verification.checks.paystackRecovery as Record<
      string,
      unknown
    >;
    expect(recovery.replayEventId).toBe('event-1');
    expect(recovery.replayStatus).toBe('REQUESTED');
    expect(JSON.stringify(recovery)).not.toContain('customer_code');
  });

  it('does not request the same replay again after the cooldown expires', async () => {
    const { service, paystack } = makeHarness();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00.000Z'));
    paystack.page.mockResolvedValue({
      data: [
        {
          _id: 'event-once',
          event_name: 'customeridentification.success',
          category: 'customers',
          category_row_id: 456,
          domain: 'live',
        },
      ],
      meta: { next: null },
    });
    paystack.request
      .mockResolvedValueOnce({
        customer_code: 'CUS_123',
        id: 456,
        domain: 'live',
        identified: false,
        identifications: null,
      })
      .mockResolvedValueOnce({
        _id: 'event-once',
        domain: 'live',
        category: 'customers',
        category_row_id: 456,
        event_name: 'customeridentification.success',
        createdAt: '2026-10-31T04:32:00Z',
        event_payload: {
          event: 'customeridentification.success',
          data: { customer_code: 'CUS_123', customer_id: 456 },
        },
      })
      .mockResolvedValueOnce({ count: 1, failed: 0, failed_ids: [] });

    await expect(service.reconcile('user-1')).resolves.toMatchObject({
      state: 'WEBHOOK_REQUESTED',
    });
    await expect(service.reconcile('user-1')).resolves.toMatchObject({
      state: 'WEBHOOK_REQUESTED',
    });

    expect(paystack.request).toHaveBeenCalledTimes(3);
    expect(paystack.page).toHaveBeenCalledTimes(1);
  });

  it('keeps an outbound replay reserved when the provider response is unknown', async () => {
    const { service, paystack } = makeHarness();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00.000Z'));
    paystack.page.mockResolvedValue({
      data: [
        {
          _id: 'event-unknown',
          event_name: 'customeridentification.success',
          category: 'customers',
          category_row_id: 456,
          domain: 'live',
        },
      ],
      meta: { next: null },
    });
    paystack.request
      .mockResolvedValueOnce({
        customer_code: 'CUS_123',
        id: 456,
        domain: 'live',
        identified: false,
        identifications: null,
      })
      .mockResolvedValueOnce({
        _id: 'event-unknown',
        domain: 'live',
        category: 'customers',
        category_row_id: 456,
        event_name: 'customeridentification.success',
        createdAt: '2026-10-31T04:32:00Z',
        event_payload: {
          event: 'customeridentification.success',
          data: { customer_code: 'CUS_123', customer_id: 456 },
        },
      })
      .mockResolvedValueOnce(undefined);

    await expect(service.reconcile('user-1')).resolves.toMatchObject({
      state: 'TEMPORARILY_UNAVAILABLE',
    });
    jest.advanceTimersByTime(61_000);
    await expect(service.reconcile('user-1')).resolves.toMatchObject({
      state: 'TEMPORARILY_UNAVAILABLE',
    });

    expect(paystack.request).toHaveBeenCalledTimes(3);
  });

  it('does not replay an event with a foreign domain or customer id', async () => {
    const { service, paystack } = makeHarness();
    paystack.page.mockResolvedValue({
      data: [
        {
          _id: 'event-foreign',
          event_name: 'customeridentification.success',
          domain: 'live',
          category: 'customers',
          category_row_id: 456,
        },
      ],
      meta: { next: null },
    });
    paystack.request
      .mockResolvedValueOnce({
        customer_code: 'CUS_123',
        id: 456,
        domain: 'live',
        identified: false,
        identifications: null,
      })
      .mockResolvedValueOnce({
        _id: 'event-foreign',
        domain: 'test',
        event_payload: {
          event: 'customeridentification.success',
          data: { customer_code: 'CUS_123', customer_id: 999 },
        },
      });

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('ACTION_REQUIRED');
    expect(paystack.request).not.toHaveBeenCalledWith(
      'POST',
      '/integration/webhooks/events/resend',
      expect.anything(),
    );
  });

  it('requires action when Paystack says identified but no terminal event matches', async () => {
    const { service, paystack } = makeHarness({}, { identified: true });
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00.000Z'));

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('ACTION_REQUIRED');
    expect(paystack.request).not.toHaveBeenCalledWith(
      'POST',
      '/integration/webhooks/events/resend',
      expect.anything(),
    );
  });

  it('returns a sanitized temporary-unavailable view on provider timeout', async () => {
    const { service, paystack, prisma, state } = makeHarness();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00.000Z'));
    paystack.request.mockRejectedValueOnce(
      new ServiceUnavailableException('provider payload must not escape'),
    );

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('TEMPORARILY_UNAVAILABLE');
    expect(result.message).not.toContain('provider payload');
    expect(JSON.stringify(state.verification.checks)).not.toContain(
      'provider payload',
    );
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      'provider payload',
    );
  });

  it('stops provider traversal after the shared wall-clock deadline', async () => {
    const { service, paystack } = makeHarness();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00.000Z'));
    paystack.request.mockImplementationOnce(async () => {
      jest.advanceTimersByTime(20_001);
      return {
        customer_code: 'CUS_123',
        id: 456,
        domain: 'live',
        identified: false,
        identifications: null,
      };
    });

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('TEMPORARILY_UNAVAILABLE');
    expect(paystack.page).not.toHaveBeenCalled();
  });

  it.each([
    { count: 0, failed: 0, failed_ids: [] },
    { count: 1, failed: 1, failed_ids: [] },
    { count: 1, failed: 0 },
  ])(
    'does not report malformed replay acknowledgement as accepted: %o',
    async (response) => {
      const { service, paystack } = makeHarness();
      jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00Z'));
      paystack.page.mockResolvedValue({
        data: [
          {
            _id: 'event-ack',
            event_name: 'customeridentification.success',
            domain: 'live',
            category: 'customers',
            category_row_id: 456,
          },
        ],
      });
      paystack.request.mockImplementation(
        async (method: string, path: string) => {
          if (method === 'POST') return response;
          if (path.startsWith('/customer/'))
            return {
              id: 456,
              customer_code: 'CUS_123',
              domain: 'live',
              identified: false,
            };
          return {
            _id: 'event-ack',
            domain: 'live',
            category: 'customers',
            category_row_id: 456,
            event_name: 'customeridentification.success',
            createdAt: '2026-10-31T04:32:00Z',
            event_payload: {
              event: 'customeridentification.success',
              data: { customer_code: 'CUS_123', customer_id: 456 },
            },
          };
        },
      );
      expect((await service.reconcile('user-1')).state).toBe(
        'TEMPORARILY_UNAVAILABLE',
      );
      jest.advanceTimersByTime(61_000);
      await service.reconcile('user-1');
      expect(
        paystack.request.mock.calls.filter(([method]) => method === 'POST'),
      ).toHaveLength(1);
    },
  );

  it('does not replay when event history exceeds the page bound', async () => {
    const { service, paystack } = makeHarness();
    paystack.page.mockResolvedValue({
      data: [],
      meta: { next: 'another-page' },
    });
    expect((await service.reconcile('user-1')).state).toBe('ACTION_REQUIRED');
    expect(paystack.page).toHaveBeenCalledTimes(4);
    expect(
      paystack.request.mock.calls.filter(([method]) => method === 'POST'),
    ).toHaveLength(0);
  });

  it('bounds an unresolved replay response and never sends it twice', async () => {
    const { service, paystack } = makeHarness();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00Z'));
    paystack.page.mockResolvedValue({
      data: [
        {
          _id: 'event-slow',
          domain: 'live',
          category: 'customers',
          category_row_id: 456,
          event_name: 'customeridentification.success',
        },
      ],
    });
    paystack.request.mockImplementation(
      async (method: string, path: string) => {
        if (method === 'POST') return new Promise(() => {});
        if (path.startsWith('/customer/'))
          return {
            id: 456,
            domain: 'live',
            customer_code: 'CUS_123',
            identified: false,
          };
        return {
          _id: 'event-slow',
          domain: 'live',
          category: 'customers',
          category_row_id: 456,
          event_name: 'customeridentification.success',
          createdAt: '2026-10-31T04:32:00Z',
          event_payload: {
            event: 'customeridentification.success',
            data: { customer_code: 'CUS_123', customer_id: 456 },
          },
        };
      },
    );
    const response = service.reconcile('user-1');
    await jest.advanceTimersByTimeAsync(20_001);
    expect((await response).state).toBe('TEMPORARILY_UNAVAILABLE');
    await jest.advanceTimersByTimeAsync(61_000);
    await service.reconcile('user-1');
    expect(
      paystack.request.mock.calls.filter(([method]) => method === 'POST'),
    ).toHaveLength(1);
  });

  it('returns checking and avoids duplicate provider calls while another lease is active', async () => {
    const { service, paystack } = makeHarness({
      checks: {
        customerCode: 'CUS_123',
        validationFingerprint: 'fingerprint-1',
        paystackRecovery: {
          state: 'CHECKING',
          leaseId: 'other-lease',
          leaseUntil: '2099-01-01T00:00:00.000Z',
          supportReference: 'support-1',
          checkedAt: null,
        },
      },
    });
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00.000Z'));

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('CHECKING');
    expect(result.supportReference).toBe('KYC-document-1');
    expect(paystack.request).not.toHaveBeenCalled();
    expect(paystack.page).not.toHaveBeenCalled();
  });

  it('does not overwrite a terminal callback that wins during replay', async () => {
    const { service, paystack, state } = makeHarness();
    paystack.page.mockResolvedValue({
      data: [
        {
          _id: 'event-race',
          event_name: 'customeridentification.success',
          category: 'customers',
          category_row_id: 456,
          domain: 'live',
        },
      ],
      meta: { next: null },
    });
    paystack.request
      .mockResolvedValueOnce({
        customer_code: 'CUS_123',
        id: 456,
        domain: 'live',
        identified: false,
        identifications: null,
      })
      .mockResolvedValueOnce({
        _id: 'event-race',
        domain: 'live',
        category: 'customers',
        category_row_id: 456,
        event_name: 'customeridentification.success',
        createdAt: '2026-10-31T04:32:00Z',
        event_payload: {
          event: 'customeridentification.success',
          data: { customer_code: 'CUS_123', customer_id: 456 },
        },
      })
      .mockImplementationOnce(async () => {
        state.verification.status = 'VERIFIED';
        return { count: 1, failed: 0, failed_ids: [] };
      });

    const result = await service.reconcile('user-1');

    expect(result.state).toBe('NO_PENDING');
    expect(state.verification.status).toBe('VERIFIED');
    expect(state.verification.checks.paystackRecovery).toEqual(
      expect.objectContaining({ replayEventId: 'event-race' }),
    );
  });
});
