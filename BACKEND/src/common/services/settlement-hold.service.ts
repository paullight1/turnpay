import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, WalletCurrency } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const RECONCILIATION_HOLD_CLEAR_ACTION = 'RECONCILIATION_HOLD_CLEARED';

/**
 * Operations which can move value out of TRUSTPAY or complete an external
 * settlement. Credits and compensating reversals deliberately do not use this
 * type: an outstanding reconciliation issue must not strand incoming money or
 * a customer refund.
 */
export type SettlementHoldOperation =
  | 'WITHDRAWAL'
  | 'EXCHANGE'
  | 'VTU'
  | 'INTERNAL_TRANSFER'
  | 'MANUAL_EXCHANGE'
  | 'OUTBOUND_SETTLEMENT'
  | 'OUTBOUND_DEBIT';

export interface SettlementHoldCheck {
  operation?: SettlementHoldOperation;
  /** User whose outbound movement is being authorized, when known. */
  userId?: string;
  /**
   * Internal-only recovery authorization: skip only adverse-funding cases;
   * reconciliation holds remain enforced.
   */
  skipAdverseFundingHold?: boolean;
  /** Optional reconciliation scope for a provider or product-specific run. */
  scope?: string;
  currency?: WalletCurrency;
  provider?: string;
  reference?: string;
}

type SettlementHoldClient = Pick<
  Prisma.TransactionClient,
  'reconciliationRun' | 'auditLog'
> & {
  // Optional keeps lightweight unit-test transaction doubles honest while
  // real Prisma clients use the additive adverse-case table when available.
  fundingAdverseCase?: Prisma.TransactionClient['fundingAdverseCase'];
};

type ReconciliationRunForHold = {
  id: string;
  scope: string;
  status: string;
  createdAt: Date;
  mismatchCount: number;
};

type AuditForHold = {
  id: string;
  adminId: string | null;
  reason: string | null;
  targetId: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

/**
 * Reads the persisted reconciliation state at the point money movement is
 * authorized. A BLOCKED run remains effective until an operator explicitly
 * clears that exact run after a later, same-scope zero-mismatch run.
 */
@Injectable()
export class SettlementHoldService {
  /** Global wallet/accounting scopes stop every outbound operation. */
  static readonly GLOBAL_SCOPES = ['WALLET_BALANCES', 'ADMIN_BANKING'] as const;

  /** Product scopes stop only that product's outbound settlement. */
  static readonly OPERATION_SCOPES: Readonly<
    Record<SettlementHoldOperation, readonly string[]>
  > = {
    WITHDRAWAL: ['WITHDRAWALS', 'WITHDRAWAL_SETTLEMENT'],
    EXCHANGE: ['EXCHANGE', 'EXCHANGE_SETTLEMENT'],
    VTU: ['VTU', 'VTU_SETTLEMENT'],
    INTERNAL_TRANSFER: ['INTERNAL_TRANSFERS'],
    MANUAL_EXCHANGE: ['MANUAL_EXCHANGE'],
    OUTBOUND_SETTLEMENT: ['SETTLEMENT'],
    OUTBOUND_DEBIT: ['SETTLEMENT'],
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Throws while any relevant BLOCKED reconciliation run has not received an
   * explicit, audited clearance. Every unresolved run is considered; a newer
   * passing run or an unrelated cleared run cannot hide another block.
   */
  async assertOutboundAllowed(
    input: SettlementHoldCheck,
    client?: SettlementHoldClient | PrismaService,
  ) {
    const db = client ?? this.prisma;

    // A signed provider refund/dispute is a merchant exposure until it has
    // been independently correlated and explicitly resolved. Keep this check
    // global because some provider-dispatch paths do not carry a user id; a
    // user-scoped-only hold there would let an already-reserved payout bypass
    // the adverse-funding review. Incoming credits and compensating reversals
    // intentionally do not call this outbound guard.
    const adverseCaseDelegate = (db as SettlementHoldClient).fundingAdverseCase;
    if (!input.skipAdverseFundingHold && adverseCaseDelegate?.findMany) {
      const activeCases = await adverseCaseDelegate.findMany({
        where: {
          holdRequired: true,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          id: true,
          provider: true,
          eventType: true,
          providerReference: true,
        },
      });

      if (activeCases.length > 0) {
        const first = activeCases[0];
        throw new ServiceUnavailableException(
          'Outbound settlement is temporarily unavailable while a funding event is under review',
          {
            cause: {
              code: 'PAYSTACK_FUNDING_ADVERSE_HOLD',
              caseId: first.id,
              provider: first.provider,
              eventType: first.eventType,
              providerReference: first.providerReference,
            },
          },
        );
      }
    }

    const scopes = this.relevantScopes(input);
    const blockedRuns = (await db.reconciliationRun.findMany({
      where: {
        status: 'BLOCKED',
        scope: { in: scopes },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        scope: true,
        status: true,
        createdAt: true,
        mismatchCount: true,
      },
    })) as ReconciliationRunForHold[];

    if (blockedRuns.length === 0) {
      return;
    }

    const clearances = (await db.auditLog.findMany({
      where: {
        action: RECONCILIATION_HOLD_CLEAR_ACTION,
        targetType: 'ReconciliationRun',
        targetId: { in: blockedRuns.map((run) => run.id) },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        adminId: true,
        reason: true,
        targetId: true,
        metadata: true,
        createdAt: true,
      },
    })) as AuditForHold[];

    const clearedRunIds = new Set(
      clearances
        .filter((audit) => this.isValidClearance(audit))
        .map((audit) => audit.targetId),
    );
    const unresolved = blockedRuns.filter((run) => !clearedRunIds.has(run.id));

    if (unresolved.length > 0) {
      const first = unresolved[0];
      throw new ServiceUnavailableException(
        'Outbound settlement is temporarily unavailable while reconciliation is blocked',
        {
          cause: {
            code: 'RECONCILIATION_SETTLEMENT_HOLD',
            runId: first.id,
            scope: first.scope,
            mismatchCount: first.mismatchCount,
          },
        },
      );
    }
  }

  /** Alias used by provider-facing services when they are settling externally. */
  assertSettlementAllowed(
    input: SettlementHoldCheck,
    client?: SettlementHoldClient | PrismaService,
  ) {
    return this.assertOutboundAllowed(
      { ...input, operation: input.operation ?? 'OUTBOUND_SETTLEMENT' },
      client,
    );
  }

  /**
   * Clears one persisted BLOCKED run after a later, same-scope completed run
   * proves zero mismatches. The BLOCKED row remains immutable history; the
   * audit record is the explicit release marker consumed by the guard.
   */
  async clearHoldAfterPassingRun(
    blockedRunId: string,
    passingRunId: string,
    adminId: string,
    reason: string,
  ) {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 10) {
      throw new BadRequestException(
        'A reconciliation hold clearance reason of at least 10 characters is required',
      );
    }
    if (blockedRunId === passingRunId) {
      throw new ConflictException(
        'A blocked reconciliation run cannot clear itself',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const blocked = await tx.reconciliationRun.findUnique({
          where: { id: blockedRunId },
          select: {
            id: true,
            scope: true,
            status: true,
            createdAt: true,
            mismatchCount: true,
          },
        });
        if (!blocked) {
          throw new ConflictException('Blocked reconciliation run not found');
        }
        if (blocked.status !== 'BLOCKED') {
          throw new ConflictException(
            'Only a BLOCKED reconciliation run can hold settlement',
          );
        }

        const passing = await tx.reconciliationRun.findUnique({
          where: { id: passingRunId },
          select: {
            id: true,
            scope: true,
            status: true,
            createdAt: true,
            mismatchCount: true,
          },
        });
        if (!passing) {
          throw new ConflictException('Passing reconciliation run not found');
        }
        if (
          passing.scope !== blocked.scope ||
          passing.status !== 'COMPLETED' ||
          passing.mismatchCount !== 0 ||
          passing.createdAt <= blocked.createdAt
        ) {
          throw new ConflictException(
            'Settlement can only be released after a later, same-scope zero-mismatch reconciliation run',
          );
        }

        const existing = await tx.auditLog.findFirst({
          where: {
            action: RECONCILIATION_HOLD_CLEAR_ACTION,
            targetType: 'ReconciliationRun',
            targetId: blockedRunId,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            adminId: true,
            reason: true,
            targetId: true,
            metadata: true,
            createdAt: true,
          },
        });

        if (existing) {
          const existingPassingRunId = this.metadataString(
            existing.metadata,
            'passingRunId',
          );
          if (existingPassingRunId === passingRunId) {
            return {
              status: 'CLEARED' as const,
              blockedRunId,
              passingRunId,
              scope: blocked.scope,
              auditId: existing.id,
              clearedAt: existing.createdAt,
            };
          }
          throw new ConflictException(
            'This reconciliation hold has already been cleared against another passing run',
          );
        }

        const audit = await tx.auditLog.create({
          data: {
            adminId,
            action: RECONCILIATION_HOLD_CLEAR_ACTION,
            targetType: 'ReconciliationRun',
            targetId: blockedRunId,
            reference: passingRunId,
            reason: trimmedReason,
            before: {
              status: blocked.status,
              scope: blocked.scope,
              mismatchCount: blocked.mismatchCount,
            },
            after: {
              status: blocked.status,
              holdCleared: true,
              passingRunId,
              passingRunStatus: passing.status,
              passingMismatchCount: passing.mismatchCount,
            },
            metadata: {
              blockedRunId,
              passingRunId,
              scope: blocked.scope,
              clearance: 'EXPLICIT_PASSING_RERUN',
            },
          },
          select: { id: true, createdAt: true },
        });

        return {
          status: 'CLEARED' as const,
          blockedRunId,
          passingRunId,
          scope: blocked.scope,
          auditId: audit.id,
          clearedAt: audit.createdAt,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 5000,
        maxWait: 3000,
      },
    );
  }

  private relevantScopes(input: SettlementHoldCheck) {
    const scopes = new Set<string>(SettlementHoldService.GLOBAL_SCOPES);
    const explicitScope = input.scope?.trim().toUpperCase();
    if (explicitScope) scopes.add(explicitScope);

    const operation = input.operation?.trim().toUpperCase() as
      | SettlementHoldOperation
      | undefined;
    if (operation && operation in SettlementHoldService.OPERATION_SCOPES) {
      for (const scope of SettlementHoldService.OPERATION_SCOPES[operation]) {
        scopes.add(scope);
      }
    }

    return [...scopes];
  }

  private isValidClearance(audit: AuditForHold) {
    const passingRunId = this.metadataString(audit.metadata, 'passingRunId');
    return Boolean(
      audit.adminId &&
      audit.reason?.trim() &&
      audit.reason.trim().length >= 10 &&
      passingRunId &&
      this.metadataString(audit.metadata, 'blockedRunId') === audit.targetId &&
      this.metadataString(audit.metadata, 'clearance') ===
        'EXPLICIT_PASSING_RERUN',
    );
  }

  private metadataString(value: Prisma.JsonValue | null, key: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' ? candidate : undefined;
  }
}

/**
 * Maps a ledger source to the narrowest hold scope. Unknown debit sources are
 * intentionally fail-closed as OUTBOUND_DEBIT in LedgerService.
 */
export function settlementOperationForSource(
  source: string,
): SettlementHoldOperation {
  const normalized = source.trim().toUpperCase();
  if (normalized.startsWith('WITHDRAWAL')) return 'WITHDRAWAL';
  if (normalized.startsWith('EXCHANGE')) return 'EXCHANGE';
  if (normalized.startsWith('VTU')) return 'VTU';
  if (normalized.startsWith('INTERNAL_TRANSFER')) return 'INTERNAL_TRANSFER';
  if (normalized.startsWith('MANUAL_EXCHANGE')) return 'MANUAL_EXCHANGE';
  return 'OUTBOUND_DEBIT';
}

export function isCompensatingLedgerSource(source: string) {
  const normalized = source.trim().toUpperCase();
  return (
    normalized.includes('REVERSAL') ||
    normalized.includes('REFUND') ||
    normalized.includes('COMPENSATION')
  );
}

export function isReconciliationSettlementHoldError(error: unknown) {
  return (
    error instanceof ServiceUnavailableException &&
    error.message.includes('reconciliation is blocked')
  );
}
