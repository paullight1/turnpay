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

    try {
      const result = await this.reconcileWallets();

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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown reconciliation error';

      this.pinoLogger.error({ errorMessage }, 'Daily reconciliation failed');
    }
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
}
