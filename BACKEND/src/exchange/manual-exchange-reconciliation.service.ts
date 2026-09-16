import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';

/** Internal evidence checks only. Operators must still reconcile bank/MoMo statements. */
@Injectable()
export class ManualExchangeReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  latest() {
    return this.prisma.reconciliationRun.findMany({
      where: { scope: 'MANUAL_EXCHANGE' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async run() {
    const run = await this.prisma.reconciliationRun.create({
      data: { scope: 'MANUAL_EXCHANGE' },
    });
    try {
      const result = await this.check();
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: result.mismatches.length ? 'BLOCKED' : 'COMPLETED',
          completedAt: new Date(),
          checkedCount: result.totalChecked,
          mismatchCount: result.mismatches.length,
          mismatchDetails: result.mismatches,
        },
      });
      if (result.mismatches.length) {
        this.logger.error(
          {
            alertCode: 'MANUAL_EXCHANGE_RECONCILIATION_BLOCKED',
            runId: run.id,
            mismatchCount: result.mismatches.length,
          },
          'Manual exchange needs reconciliation',
        );
        Sentry.captureMessage('Manual exchange reconciliation blocked payout', {
          level: 'error',
          tags: {
            alertCode: 'MANUAL_EXCHANGE_RECONCILIATION_BLOCKED',
            reconciliationScope: 'MANUAL_EXCHANGE',
          },
          extra: {
            runId: run.id,
            mismatchCount: result.mismatches.length,
            checkedOrders: result.totalChecked,
          },
        });
      }
      return result;
    } catch {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: 'Internal exchange reconciliation failed',
        },
      });
      this.logger.error(
        { alertCode: 'MANUAL_EXCHANGE_RECONCILIATION_FAILED', runId: run.id },
        'Manual exchange reconciliation failed',
      );
      // Cron failure is recorded; no balance corrections are ever made here.
    }
  }

  async check() {
    const mismatches: Array<{ reference: string; code: string }> = [];
    let cursor: string | undefined;
    let totalChecked = 0;
    // Each bounded page sees its orders, transactions, allocations and ledger at one snapshot.
    for (;;) {
      const page = await this.prisma.$transaction(
        async (tx) => {
          const orders = await tx.manualExchangeOrder.findMany({
            take: 250,
            orderBy: { id: 'asc' },
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
              transaction: {
                include: {
                  ledgerEntries: {
                    include: { wallet: { select: { userId: true } } },
                  },
                },
              },
            },
          });
          const allocations = await tx.exchangeDepositAllocation.findMany({
            where: { settlementId: { in: orders.map((o) => o.id) } },
          });
          return { orders, allocations };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 5000,
        },
      );
      for (const row of page.orders) {
        const add = (code: string) =>
          mismatches.push({ reference: row.reference, code });
        const confirmed = [
          'CREDITED',
          'PAYOUT_PENDING',
          'PAYOUT_PROCESSING',
          'PAYOUT_SENT',
          'COMPLETED',
        ].includes(row.status);
        const allocation = page.allocations.find(
          (a) => a.settlementId === row.id,
        );
        if (
          confirmed
            ? !allocation ||
              allocation.reference !== row.depositReference ||
              !allocation.amount.equals(row.amount)
            : !!allocation || !!row.depositReference
        )
          add('DEPOSIT_ALLOCATION_MISMATCH');
        const transaction = row.transaction;
        const expectedStatus =
          row.status === 'CREDITED' || row.status === 'COMPLETED'
            ? 'SUCCESS'
            : row.status === 'REJECTED'
              ? 'FAILED'
              : 'PENDING';
        if (
          transaction.status !== expectedStatus ||
          transaction.userId !== row.userId ||
          transaction.currency !== row.sourceCurrency ||
          !transaction.amount.equals(row.amount)
        )
          add('TRANSACTION_MISMATCH');
        const entries = transaction.ledgerEntries;
        if (row.status === 'CREDITED') {
          const credit = entries[0];
          if (
            row.settlementMode !== 'WALLET' ||
            entries.length !== 1 ||
            !credit ||
            credit.direction !== 'CREDIT' ||
            credit.source !== 'MANUAL_EXCHANGE_ORDER_CREDIT' ||
            credit.currency !== row.targetCurrency ||
            !credit.amount.equals(row.targetAmount) ||
            credit.wallet.userId !== row.userId ||
            credit.reference !== row.reference
          )
            add('WALLET_CREDIT_MISMATCH');
        } else if (entries.length) add('UNEXPECTED_WALLET_MOVEMENT');
        if (
          ['PAYOUT_SENT', 'COMPLETED'].includes(row.status) &&
          (!row.payoutReference ||
            !row.payoutProofKey ||
            !row.payoutClaimedBy ||
            row.settlementMode === 'WALLET')
        )
          add('PAYOUT_EVIDENCE_MISSING');
        if (confirmed && !row.proofKey) add('DEPOSIT_PROOF_MISSING');
      }
      totalChecked += page.orders.length;
      if (page.orders.length < 250) break;
      cursor = page.orders[page.orders.length - 1].id;
    }
    return { totalChecked, mismatches };
  }
}
