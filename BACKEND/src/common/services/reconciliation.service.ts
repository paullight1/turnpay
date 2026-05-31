import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "../../prisma/prisma.service";
import { PinoLogger } from "nestjs-pino";

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinoLogger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyReconciliation() {
    this.pinoLogger.info({}, "Starting daily reconciliation");

    try {
      const result = await this.reconcileWallets();

      this.pinoLogger.info(
        {
          mismatches: result.mismatches.length,
          checkedWallets: result.totalChecked,
          timestamp: new Date().toISOString(),
        },
        "Daily reconciliation completed",
      );

      if (result.mismatches.length > 0) {
        this.pinoLogger.warn(
          { mismatchCount: result.mismatches.length },
          "Found wallet mismatches",
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown reconciliation error";

      this.pinoLogger.error({ errorMessage }, "Daily reconciliation failed");
    }
  }

  async reconcileWallets() {
    const wallets = await this.prisma.wallet.findMany({
      select: {
        id: true,
        userId: true,
        currency: true,
        balance: true,
        ledgerEntries: {
          select: {
            direction: true,
            amount: true,
            currency: true,
          },
        },
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
      let expectedBalance = new Decimal(0);

      for (const entry of wallet.ledgerEntries) {
        if (entry.currency !== wallet.currency) continue;

        const entryAmount = new Decimal(entry.amount);

        if (entry.direction === "CREDIT") {
          expectedBalance = expectedBalance.plus(entryAmount);
        } else {
          expectedBalance = expectedBalance.minus(entryAmount);
        }
      }

      const actualBalance = new Decimal(wallet.balance);
      const difference = expectedBalance.minus(actualBalance).abs();

      if (difference.greaterThan(new Decimal("0.01"))) {
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
