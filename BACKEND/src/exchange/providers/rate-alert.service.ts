import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { RateService } from "./rate.service";
import { PinoLogger } from "nestjs-pino";

/**
 * NotificationService — stub for future Firebase/APNs push notification integration.
 * Currently logs to the application logger. Replace with actual push delivery.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly logger: PinoLogger) {}

  /**
   * Send a push notification to a user.
   * STUB: Logs to Pino. Replace with Firebase Admin SDK / APNs integration.
   */
  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.info(
      {
        userId,
        title,
        body,
        data,
      },
      "[NOTIFICATION STUB] Push notification would be sent here",
    );
    // TODO: Integrate with Firebase Cloud Messaging or APNs
  }

  /**
   * Create an in-app alert for a user.
   * STUB: Logs to Pino. Replace with in-app notification table + WebSocket push.
   */
  async sendInAppAlert(
    userId: string,
    type: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.info(
      {
        userId,
        type,
        message,
        metadata,
      },
      "[NOTIFICATION STUB] In-app alert would be created here",
    );
    // TODO: Insert into an in-app notifications table and push via WebSocket
  }
}

/**
 * RateAlertService — monitors exchange rates and triggers alerts when
 * user-defined rate thresholds are met.
 */
@Injectable()
export class RateAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateService: RateService,
    private readonly notificationService: NotificationService,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Check all active rate alerts every 60 seconds.
   * Compares cached rates against user targets and fires alerts.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkRateAlerts(): Promise<void> {
    const activeAlerts = await this.prisma.rateAlert.findMany({
      where: { isActive: true, triggeredAt: null },
    });

    if (activeAlerts.length === 0) {
      return;
    }

    let triggered = 0;
    let errors = 0;

    for (const alert of activeAlerts) {
      try {
        const { rate } = await this.rateService.getRate(
          alert.fromCurrency,
          alert.toCurrency,
        );

        const targetRate = alert.targetRate.toNumber();
        const isTriggered =
          alert.direction === "ABOVE"
            ? rate >= targetRate
            : rate <= targetRate;

        if (isTriggered) {
          const fromTo = `${alert.fromCurrency}→${alert.toCurrency}`;
          const directionLabel =
            alert.direction === "ABOVE" ? "above" : "below";
          const title = `Rate Alert: ${fromTo}`;
          const body = `The ${fromTo} rate is now ${rate.toFixed(4)}, ${directionLabel} your target of ${targetRate.toFixed(4)}`;

          await this.prisma.rateAlert.update({
            where: { id: alert.id },
            data: { triggeredAt: new Date() },
          });

          await this.notificationService.sendPushNotification(
            alert.userId,
            title,
            body,
            {
              alertId: alert.id,
              fromCurrency: alert.fromCurrency,
              toCurrency: alert.toCurrency,
              currentRate: rate,
              targetRate: targetRate,
              direction: alert.direction,
            },
          );

          await this.notificationService.sendInAppAlert(
            alert.userId,
            "RATE_ALERT_TRIGGERED",
            body,
            {
              alertId: alert.id,
              fromCurrency: alert.fromCurrency,
              toCurrency: alert.toCurrency,
              currentRate: rate,
              targetRate: targetRate,
            },
          );

          this.logger.info(
            {
              alertId: alert.id,
              userId: alert.userId,
              from: alert.fromCurrency,
              to: alert.toCurrency,
              currentRate: rate,
              targetRate,
              direction: alert.direction,
            },
            "Rate alert triggered",
          );

          triggered++;
        }
      } catch (error) {
        this.logger.error(
          {
            alertId: alert.id,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Failed to check rate alert",
        );
        errors++;
      }
    }

    if (triggered > 0 || errors > 0) {
      this.logger.info(
        { triggered, errors, checked: activeAlerts.length },
        "Rate alert check completed",
      );
    }
  }

  async createAlert(
    userId: string,
    dto: {
      fromCurrency: string;
      toCurrency: string;
      targetRate: number;
      direction: "ABOVE" | "BELOW";
    },
  ) {
    if (dto.fromCurrency === dto.toCurrency) {
      throw new Error("Source and destination currencies must be different");
    }

    const alert = await this.prisma.rateAlert.create({
      data: {
        userId,
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
        targetRate: dto.targetRate,
        direction: dto.direction,
      },
    });

    this.logger.info(
      {
        alertId: alert.id,
        userId,
        from: dto.fromCurrency,
        to: dto.toCurrency,
        targetRate: dto.targetRate,
        direction: dto.direction,
      },
      "Rate alert created",
    );

    return alert;
  }

  async getUserAlerts(userId: string) {
    return this.prisma.rateAlert.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async deleteAlert(alertId: string, userId: string) {
    const alert = await this.prisma.rateAlert.findFirst({
      where: { id: alertId, userId },
    });

    if (!alert) {
      throw new Error("Rate alert not found");
    }

    await this.prisma.rateAlert.delete({
      where: { id: alertId },
    });

    this.logger.info(
      { alertId, userId },
      "Rate alert deleted",
    );

    return { success: true };
  }
}
