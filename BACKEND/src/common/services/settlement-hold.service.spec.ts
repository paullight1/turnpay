import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { SettlementHoldService } from './settlement-hold.service';

describe('SettlementHoldService', () => {
  const prisma = {
    reconciliationRun: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    fundingAdverseCase: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(
      async (operation: (tx: unknown) => unknown): Promise<unknown> =>
        operation(prisma),
    ),
  };

  let service: SettlementHoldService;

  const blockedRun = (overrides: Record<string, unknown> = {}) => ({
    id: 'blocked-run',
    scope: 'WALLET_BALANCES',
    status: 'BLOCKED',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    mismatchCount: 1,
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (tx: unknown) => unknown) => operation(prisma),
    );
    prisma.reconciliationRun.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.fundingAdverseCase.findMany.mockResolvedValue([]);
  });

  beforeEach(() => {
    service = new SettlementHoldService(prisma as never);
  });

  it('keeps every unresolved blocked run effective even when a newer run passed', async () => {
    prisma.reconciliationRun.findMany.mockResolvedValue([
      blockedRun(),
      blockedRun({
        id: 'blocked-run-2',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      }),
    ]);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'clear-1',
        adminId: 'admin-1',
        reason: 'Later wallet check passed',
        targetId: 'blocked-run',
        metadata: {
          blockedRunId: 'blocked-run',
          passingRunId: 'passing-run',
          clearance: 'EXPLICIT_PASSING_RERUN',
        },
        createdAt: new Date('2026-09-03T10:00:00.000Z'),
      },
    ]);

    await expect(
      service.assertOutboundAllowed({ operation: 'WITHDRAWAL' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.reconciliationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'BLOCKED',
          scope: { in: expect.arrayContaining(['WALLET_BALANCES']) },
        }),
      }),
    );
  });

  it('blocks every outbound operation while a Paystack adverse-funding case is held', async () => {
    prisma.fundingAdverseCase.findMany.mockResolvedValue([
      {
        id: 'adverse-case-1',
        provider: 'PAYSTACK',
        eventType: 'refund.processed',
        providerReference: 'refund-1',
        status: 'OPEN',
        holdRequired: true,
      },
    ]);

    await expect(
      service.assertOutboundAllowed({ operation: 'WITHDRAWAL' }),
    ).rejects.toThrow('funding event is under review');

    expect(prisma.fundingAdverseCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          holdRequired: true,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
        }),
      }),
    );
  });

  it('allows outbound settlement only when all relevant blocked runs have audited clearances', async () => {
    prisma.reconciliationRun.findMany.mockResolvedValue([
      blockedRun(),
      blockedRun({
        id: 'blocked-run-2',
        scope: 'WITHDRAWAL_SETTLEMENT',
      }),
    ]);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'clear-2',
        adminId: 'admin-1',
        reason: 'Wallet and withdrawal checks passed',
        targetId: 'blocked-run-2',
        metadata: {
          blockedRunId: 'blocked-run-2',
          passingRunId: 'pass-2',
          clearance: 'EXPLICIT_PASSING_RERUN',
        },
        createdAt: new Date(),
      },
      {
        id: 'clear-1',
        adminId: 'admin-1',
        reason: 'Wallet reconciliation passed',
        targetId: 'blocked-run',
        metadata: {
          blockedRunId: 'blocked-run',
          passingRunId: 'pass-1',
          clearance: 'EXPLICIT_PASSING_RERUN',
        },
        createdAt: new Date(),
      },
    ]);

    await expect(
      service.assertSettlementAllowed({
        operation: 'WITHDRAWAL',
        scope: 'WITHDRAWAL_SETTLEMENT',
      }),
    ).resolves.toBeUndefined();
  });

  it('requires a later same-scope zero-mismatch run before recording clearance', async () => {
    const blocked = blockedRun();
    const passing = {
      id: 'passing-run',
      scope: 'WALLET_BALANCES',
      status: 'COMPLETED',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
      mismatchCount: 0,
    };
    prisma.reconciliationRun.findUnique
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(passing);
    prisma.auditLog.findFirst.mockResolvedValue(null);
    prisma.auditLog.create.mockResolvedValue({
      id: 'clear-1',
      createdAt: new Date('2026-09-03T10:00:00.000Z'),
    });

    await expect(
      service.clearHoldAfterPassingRun(
        'blocked-run',
        'passing-run',
        'admin-1',
        'Later wallet reconciliation passed with zero mismatches',
      ),
    ).resolves.toMatchObject({
      status: 'CLEARED',
      blockedRunId: 'blocked-run',
      passingRunId: 'passing-run',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'RECONCILIATION_HOLD_CLEARED',
          adminId: 'admin-1',
          targetId: 'blocked-run',
          reference: 'passing-run',
          metadata: expect.objectContaining({
            blockedRunId: 'blocked-run',
            passingRunId: 'passing-run',
            clearance: 'EXPLICIT_PASSING_RERUN',
          }),
        }),
      }),
    );
  });

  it('rejects an earlier, mismatched, or different-scope passing run', async () => {
    prisma.reconciliationRun.findUnique
      .mockResolvedValueOnce(blockedRun())
      .mockResolvedValueOnce({
        id: 'passing-run',
        scope: 'WITHDRAWALS',
        status: 'COMPLETED',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
        mismatchCount: 0,
      });

    await expect(
      service.clearHoldAfterPassingRun(
        'blocked-run',
        'passing-run',
        'admin-1',
        'This reason is long enough for an audit record',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('is idempotent for a repeated request using the same passing run', async () => {
    prisma.reconciliationRun.findUnique
      .mockResolvedValueOnce(blockedRun())
      .mockResolvedValueOnce({
        id: 'passing-run',
        scope: 'WALLET_BALANCES',
        status: 'COMPLETED',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
        mismatchCount: 0,
      });
    prisma.auditLog.findFirst.mockResolvedValue({
      id: 'clear-1',
      adminId: 'admin-1',
      reason: 'Wallet reconciliation passed',
      targetId: 'blocked-run',
      metadata: {
        blockedRunId: 'blocked-run',
        passingRunId: 'passing-run',
        clearance: 'EXPLICIT_PASSING_RERUN',
      },
      createdAt: new Date('2026-09-03T10:00:00.000Z'),
    });

    await expect(
      service.clearHoldAfterPassingRun(
        'blocked-run',
        'passing-run',
        'admin-2',
        'Repeat the already audited wallet clearance',
      ),
    ).resolves.toMatchObject({
      status: 'CLEARED',
      auditId: 'clear-1',
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
