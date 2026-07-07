import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PinoLogger } from "nestjs-pino";
import { PaymentService } from "./payment.service";

/**
 * Periodically resolves withdrawals left PENDING after an ambiguous provider
 * result. The disbursement webhook is the primary resolver; this cron is the
 * backstop for missed/never-delivered webhooks so reserved funds don't hang.
 */
@Injectable()
export class WithdrawalReconcileService {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePendingWithdrawals() {
    try {
      const result = await this.paymentService.reconcilePendingWithdrawals(25);

      if (result.checked > 0) {
        this.logger.info(
          { checked: result.checked, resolved: result.resolved },
          "Pending withdrawal reconciliation completed",
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown withdrawal reconciliation error";

      this.logger.error(
        { errorMessage },
        "Pending withdrawal reconciliation failed",
      );
    }
  }
}
