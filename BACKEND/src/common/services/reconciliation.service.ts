import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pinoLogger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyReconciliation() {
    this.logger.log('Starting daily reconciliation...');

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
        this.logger.warn(`Found ${result.mismatches.length} wallet mismatches`);
      }
    } catch (error) {
      this.logger.error('Reconciliation failed', error);
      this.pinoLogger.error({ error }, 'Daily reconciliation failed');
    }
  }

  async reconcileWallets() {
    const wallets = await this.prisma.wallet.findMany({
      include: {
        transactions: {
          where: { status: 'SUCCESS' },
          select: {
            type: true,
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
      expectedBalance: number;
      actualBalance: number;
      difference: number;
    }> = [];

    for (const wallet of wallets) {
      let expectedBalance = 0;

      for (const tx of wallet.transactions) {
        const txAmount = Number(tx.amount);
        const txCurrency = tx.currency;

        if (txCurrency !== wallet.currency) continue;

        switch (tx.type) {
          case 'FUND':
          case 'EXCHANGE':
            if (txCurrency === wallet.currency) {
              if (tx.type === 'FUND') {
                expectedBalance += txAmount;
              }
            }
            break;
          case 'WITHDRAW':
          case 'AIRTIME':
          case 'DATA':
          case 'CABLE':
          case 'ELECTRICITY':
            expectedBalance -= txAmount;
            break;
        }
      }

      const actualBalance = Number(wallet.balance);
      const difference = Math.abs(expectedBalance - actualBalance);

      if (difference > 0.01) {
        mismatches.push({
          walletId: wallet.id,
          userId: wallet.userId,
          currency: wallet.currency,
          expectedBalance,
          actualBalance,
          difference,
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
