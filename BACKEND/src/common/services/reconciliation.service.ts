import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinoLogger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyReconciliation() {
    this.pinoLogger.info({}, 'Starting daily reconciliation');
    const run = await this.prisma.reconciliationRun.create({
      data: { scope: 'WALLET_BALANCES' },
    });

    try {
      const result = await this.reconcileWallets();
      const status = result.mismatches.length > 0 ? 'BLOCKED' : 'COMPLETED';

      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status,
          completedAt: new Date(),
          checkedCount: result.totalChecked,
          mismatchCount: result.mismatches.length,
          mismatchDetails: result.mismatches,
        },
      });
      this.pinoLogger.info(
        {
          mismatches: result.mismatches.length,
          checkedWallets: result.totalChecked,
          timestamp: new Date().toISOString(),
        },
        'Daily reconciliation completed',
      );

      if (result.mismatches.length > 0) {
        this.pinoLogger.warn(
          { mismatchCount: result.mismatches.length },
          'Found wallet mismatches',
        );
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown reconciliation error';

      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage,
        },
      });

      this.pinoLogger.error({ errorMessage }, 'Daily reconciliation failed');
    }
  }

  getInternalTransferRuns(limit = 20) {
    return this.prisma.reconciliationRun.findMany({
      where: { scope: 'INTERNAL_TRANSFERS' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        scope: true,
        status: true,
        initiatedById: true,
        startedAt: true,
        completedAt: true,
        checkedCount: true,
        mismatchCount: true,
        mismatchDetails: true,
        errorMessage: true,
      },
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runInternalTransferReconciliation(
    initiatedById?: string,
    reason?: string,
  ) {
    const run = await this.prisma.reconciliationRun.create({
      data: { scope: 'INTERNAL_TRANSFERS', initiatedById },
    });

    try {
      const result = await this.reconcileInternalTransfers();
      const status = result.mismatches.length === 0 ? 'COMPLETED' : 'BLOCKED';
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status,
          completedAt: new Date(),
          checkedCount: result.totalChecked,
          mismatchCount: result.mismatches.length,
          mismatchDetails: result.mismatches,
        },
      });
      if (initiatedById) {
        await this.prisma.auditLog.create({
          data: {
            adminId: initiatedById,
            action: 'internal_transfer_reconciliation_run',
            targetType: 'ReconciliationRun',
            targetId: run.id,
            reason: reason?.trim(),
            after: {
              status,
              checkedCount: result.totalChecked,
              mismatchCount: result.mismatches.length,
            },
          },
        });
      }
      if (result.mismatches.length > 0) {
        this.pinoLogger.error(
          {
            alertCode: 'INTERNAL_TRANSFER_RECONCILIATION_BLOCKED',
            runId: run.id,
            mismatchCount: result.mismatches.length,
          },
          'Internal transfer reconciliation blocked',
        );
      }
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown reconciliation error';
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date(), errorMessage },
      });
      this.pinoLogger.error(
        {
          alertCode: 'INTERNAL_TRANSFER_RECONCILIATION_FAILED',
          runId: run.id,
          errorMessage,
        },
        'Internal transfer reconciliation failed',
      );
      throw error;
    }
  }

  async reconcileInternalTransfers() {
    const [attempts, reversals, usages, duplicateGroups] = await Promise.all([
      this.prisma.internalTransferAttempt.findMany({
        where: { status: 'SUCCESS' },
        select: {
          id: true,
          userId: true,
          recipientUserId: true,
          transferReference: true,
          senderTransactionId: true,
          recipientTransactionId: true,
          status: true,
          amount: true,
          currency: true,
          idempotencyKeyHash: true,
          requestHash: true,
          response: true,
          createdAt: true,
        },
      }),
      this.prisma.internalTransferReversal.findMany({
        where: { status: 'COMPLETED' },
        select: {
          id: true,
          status: true,
          originalTransferReference: true,
          reversalReference: true,
          reversalSenderTransactionId: true,
          reversalRecipientTransactionId: true,
          amount: true,
          currency: true,
        },
      }),
      this.prisma.internalTransferLimitUsage.findMany({
        select: {
          userId: true,
          currency: true,
          period: true,
          periodStart: true,
          amount: true,
        },
      }),
      this.prisma.internalTransferAttempt.groupBy({
        by: ['userId', 'idempotencyKeyHash'],
        where: { idempotencyKeyHash: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const transactionIds = new Set<string>();
    for (const attempt of attempts) {
      if (attempt.senderTransactionId)
        transactionIds.add(attempt.senderTransactionId);
      if (attempt.recipientTransactionId)
        transactionIds.add(attempt.recipientTransactionId);
    }
    for (const reversal of reversals) {
      if (reversal.reversalSenderTransactionId)
        transactionIds.add(reversal.reversalSenderTransactionId);
      if (reversal.reversalRecipientTransactionId)
        transactionIds.add(reversal.reversalRecipientTransactionId);
    }

    const transactions = await this.prisma.transaction.findMany({
      where: { id: { in: [...transactionIds] } },
      select: {
        id: true,
        userId: true,
        reference: true,
        amount: true,
        currency: true,
        type: true,
      },
    });
    const ledgers = await this.prisma.ledgerEntry.findMany({
      where: { transactionId: { in: [...transactionIds] } },
      select: {
        transactionId: true,
        direction: true,
        amount: true,
        currency: true,
        reference: true,
        source: true,
      },
    });

    const transactionById = new Map(transactions.map((row) => [row.id, row]));
    const ledgerByTransactionId = new Map(
      ledgers.map((row) => [row.transactionId, row]),
    );
    const mismatches: Array<{
      code: string;
      reference: string;
      detail: string;
    }> = [];
    const addMismatch = (code: string, reference: string, detail: string) => {
      mismatches.push({ code, reference, detail });
    };

    for (const attempt of attempts) {
      const reference = attempt.transferReference ?? `attempt:${attempt.id}`;
      const sender = attempt.senderTransactionId
        ? transactionById.get(attempt.senderTransactionId)
        : undefined;
      const recipient = attempt.recipientTransactionId
        ? transactionById.get(attempt.recipientTransactionId)
        : undefined;
      if (
        !sender ||
        !recipient ||
        !attempt.recipientUserId ||
        !attempt.amount
      ) {
        addMismatch(
          'MISSING_TRANSFER_LEG',
          reference,
          'Successful attempt is missing a linked transaction leg',
        );
      } else {
        if (
          !new Decimal(sender.amount).equals(attempt.amount) ||
          !new Decimal(recipient.amount).equals(attempt.amount)
        ) {
          addMismatch(
            'TRANSFER_AMOUNT_MISMATCH',
            reference,
            'Transfer transaction amounts do not match the attempt',
          );
        }
        if (
          sender.currency !== attempt.currency ||
          recipient.currency !== attempt.currency
        ) {
          addMismatch(
            'TRANSFER_CURRENCY_MISMATCH',
            reference,
            'Transfer transaction currencies do not match the attempt',
          );
        }
        if (
          sender.userId !== attempt.userId ||
          recipient.userId !== attempt.recipientUserId
        ) {
          addMismatch(
            'TRANSFER_ACTOR_MISMATCH',
            reference,
            'Transfer transaction owners do not match the attempt',
          );
        }
      }

      const expectedLedgers = [
        {
          transactionId: attempt.senderTransactionId,
          direction: 'DEBIT',
          source: 'INTERNAL_TRANSFER_OUT',
        },
        {
          transactionId: attempt.recipientTransactionId,
          direction: 'CREDIT',
          source: 'INTERNAL_TRANSFER_IN',
        },
      ];
      for (const expected of expectedLedgers) {
        const ledger = expected.transactionId
          ? ledgerByTransactionId.get(expected.transactionId)
          : undefined;
        if (!ledger) {
          addMismatch(
            'MISSING_LEDGER_LEG',
            reference,
            `Missing ${expected.direction.toLowerCase()} ledger leg`,
          );
          continue;
        }
        if (
          ledger.direction !== expected.direction ||
          ledger.source !== expected.source ||
          ledger.reference !== attempt.transferReference ||
          ledger.currency !== attempt.currency ||
          !attempt.amount ||
          !new Decimal(ledger.amount).equals(attempt.amount)
        ) {
          addMismatch(
            'LEDGER_LEG_MISMATCH',
            reference,
            `${expected.direction.toLowerCase()} ledger leg is inconsistent`,
          );
        }
      }

      const response = attempt.response as Record<string, unknown> | null;
      if (
        !response ||
        response.reference !== attempt.transferReference ||
        response.currency !== attempt.currency ||
        !attempt.amount ||
        !this.decimalEquals(response.amount, attempt.amount)
      ) {
        addMismatch(
          'RESPONSE_SNAPSHOT_MISMATCH',
          reference,
          'Stored idempotent response does not match the transfer attempt',
        );
      }
    }

    for (const group of duplicateGroups) {
      if (group._count._all > 1) {
        addMismatch(
          'DUPLICATE_BUSINESS_KEY',
          `key:${group.idempotencyKeyHash?.slice(0, 12) ?? 'missing'}`,
          'More than one transfer attempt uses the same user business key',
        );
      }
    }

    const expectedUsage = new Map<string, Decimal>();
    for (const attempt of attempts) {
      if (!attempt.amount || !attempt.currency) continue;
      const starts = [
        ['DAILY', this.startOfUtcDay(attempt.createdAt)],
        ['MONTHLY', this.startOfUtcMonth(attempt.createdAt)],
      ] as const;
      for (const [period, start] of starts) {
        const key = this.usageKey(
          attempt.userId,
          attempt.currency,
          period,
          start,
        );
        expectedUsage.set(
          key,
          (expectedUsage.get(key) ?? new Decimal(0)).plus(attempt.amount),
        );
      }
    }
    const actualUsage = new Map(
      usages.map((usage) => [
        this.usageKey(
          usage.userId,
          usage.currency,
          usage.period,
          usage.periodStart,
        ),
        new Decimal(usage.amount),
      ]),
    );
    for (const [key, expected] of expectedUsage) {
      const actual = actualUsage.get(key);
      if (!actual || actual.lessThan(expected)) {
        addMismatch(
          'LIMIT_USAGE_UNDERSTATED',
          `usage:${createStableDigest(key)}`,
          'Recorded transfer limit usage is below successful transfer value',
        );
      }
    }

    for (const reversal of reversals) {
      const reference = reversal.reversalReference ?? `reversal:${reversal.id}`;
      const credit = reversal.reversalSenderTransactionId
        ? transactionById.get(reversal.reversalSenderTransactionId)
        : undefined;
      const debit = reversal.reversalRecipientTransactionId
        ? transactionById.get(reversal.reversalRecipientTransactionId)
        : undefined;
      if (
        !credit ||
        !debit ||
        credit.currency !== reversal.currency ||
        debit.currency !== reversal.currency ||
        !new Decimal(credit.amount).equals(reversal.amount) ||
        !new Decimal(debit.amount).equals(reversal.amount)
      ) {
        addMismatch(
          'BROKEN_REVERSAL_PAIR',
          reference,
          'Completed reversal is missing equal compensating transaction legs',
        );
      }
    }

    return {
      totalChecked: attempts.length,
      mismatches,
      timestamp: new Date().toISOString(),
    };
  }

  async reconcileWallets() {
    // Aggregate ledger movements in the database (one row per
    // wallet/direction/currency) instead of streaming every ledger entry into
    // memory — the entry table grows unbounded and would otherwise OOM the
    // daily cron as volume increases.
    const ledgerSums = await this.prisma.ledgerEntry.groupBy({
      by: ['walletId', 'direction', 'currency'],
      _sum: { amount: true },
    });

    // walletId -> (currency -> signed expected balance)
    const expectedByWallet = new Map<string, Map<string, Decimal>>();
    for (const row of ledgerSums) {
      const amount = new Decimal(row._sum.amount ?? 0);
      const signed = row.direction === 'CREDIT' ? amount : amount.negated();

      let byCurrency = expectedByWallet.get(row.walletId);
      if (!byCurrency) {
        byCurrency = new Map<string, Decimal>();
        expectedByWallet.set(row.walletId, byCurrency);
      }
      const current = byCurrency.get(row.currency) ?? new Decimal(0);
      byCurrency.set(row.currency, current.plus(signed));
    }

    const wallets = await this.prisma.wallet.findMany({
      select: {
        id: true,
        userId: true,
        currency: true,
        balance: true,
      },
    });

    const mismatches: Array<{
      walletId: string;
      userId: string;
      currency: string;
      expectedBalance: string;
      actualBalance: string;
      difference: string;
    }> = [];

    for (const wallet of wallets) {
      // Only entries recorded in the wallet's own currency count toward its
      // expected balance (matches the previous per-entry currency filter).
      const expectedBalance =
        expectedByWallet.get(wallet.id)?.get(wallet.currency) ?? new Decimal(0);
      const actualBalance = new Decimal(wallet.balance);
      const difference = expectedBalance.minus(actualBalance).abs();

      if (difference.greaterThan(new Decimal('0.01'))) {
        mismatches.push({
          walletId: wallet.id,
          userId: wallet.userId,
          currency: wallet.currency,
          expectedBalance: expectedBalance.toFixed(2),
          actualBalance: actualBalance.toFixed(2),
          difference: difference.toFixed(2),
        });
      }
    }

    return {
      totalChecked: wallets.length,
      mismatches,
      timestamp: new Date().toISOString(),
    };
  }

  private decimalEquals(value: unknown, expected: Decimal) {
    try {
      return new Decimal(String(value)).equals(expected);
    } catch {
      return false;
    }
  }

  private startOfUtcDay(value: Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private startOfUtcMonth(value: Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  }

  private usageKey(
    userId: string,
    currency: string,
    period: string,
    periodStart: Date,
  ) {
    return `${userId}|${currency}|${period}|${periodStart.toISOString()}`;
  }
}

function createStableDigest(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
