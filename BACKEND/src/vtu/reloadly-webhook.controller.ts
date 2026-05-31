import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { createHmac, timingSafeEqual } from "crypto";
import { PinoLogger } from "nestjs-pino";
import type { RawBodyRequest } from "../common/types/request-context";
import { VtuService } from "./vtu.service";

type ReloadlyWebhookPayload = Record<string, unknown>;

type ReloadlyWebhookEvent = {
  eventType: string;
  eventId?: string;
  providerReference: string;
  providerRequestId?: string;
  status: string;
  message?: string;
  rawPayload: Record<string, unknown>;
};

@Controller("webhooks/vtu")
export class ReloadlyWebhookController {
  constructor(
    private readonly vtuService: VtuService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReloadlyWebhookController.name);
  }

  @Post("reloadly")
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleReloadlyWebhook(
    @Headers("x-reloadly-signature") reloadlySignature: string | undefined,
    @Headers("reloadly-signature") legacyReloadlySignature: string | undefined,
    @Headers("x-webhook-signature") webhookSignature: string | undefined,
    @Headers("x-signature") genericSignature: string | undefined,
    @Req() req: RawBodyRequest,
    @Body() body: ReloadlyWebhookPayload,
  ) {
    const rawBody = req.rawBody;
    const signature =
      reloadlySignature ||
      legacyReloadlySignature ||
      webhookSignature ||
      genericSignature;

    this.verifySignature(rawBody, signature);

    const event = this.normalizeEvent(body);
    await this.vtuService.recordReloadlyWebhookEvent(event);

    void this.vtuService.processReloadlyWebhookEvent(event).catch((error) => {
      this.logger.error(
        {
          providerReference: event.providerReference,
          eventType: event.eventType,
          errorMessage:
            error instanceof Error ? error.message : "Unknown webhook error",
        },
        "Reloadly webhook background processing failed",
      );
    });

    this.logger.info(
      {
        eventType: event.eventType,
        providerReference: event.providerReference,
        status: event.status,
      },
      "Reloadly VTU webhook accepted",
    );

    return { received: true };
  }

  private verifySignature(
    rawBody: string | undefined,
    receivedSignature: string | undefined,
  ) {
    const secret = this.configService.get<string>("RELOADLY_WEBHOOK_SECRET");
    if (!secret) {
      this.logger.warn("RELOADLY_WEBHOOK_SECRET is not configured");
      throw new BadRequestException(
        "Webhook signature secret is not configured",
      );
    }

    if (!receivedSignature) {
      this.logger.warn("Missing Reloadly webhook signature");
      throw new BadRequestException("Missing signature header");
    }

    if (!rawBody) {
      this.logger.warn("Missing raw body for Reloadly webhook");
      throw new BadRequestException("Missing request body");
    }

    const expectedHex = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const expectedBase64 = createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64");

    if (
      !this.timingSafeCompare(expectedHex, receivedSignature) &&
      !this.timingSafeCompare(expectedBase64, receivedSignature)
    ) {
      this.logger.warn("Invalid Reloadly webhook signature");
      throw new BadRequestException("Invalid signature");
    }
  }

  private normalizeEvent(body: ReloadlyWebhookPayload): ReloadlyWebhookEvent {
    const data = this.objectValue(body.data);
    const transaction = this.objectValue(data?.transaction) || data || body;
    const billDetails =
      this.objectValue(transaction.billDetails) ||
      this.objectValue(data?.billDetails) ||
      this.objectValue(body.billDetails);
    const eventType = this.stringValue(
      body.eventType || body.event || body.type,
    )
      .trim()
      .slice(0, 100);
    const providerReference = this.stringValue(
      transaction.transactionId ||
        transaction.id ||
        transaction.operatorTransactionId ||
        data?.transactionId ||
        body.transactionId ||
        transaction.referenceId ||
        data?.referenceId ||
        body.referenceId ||
        billDetails?.billerReferenceId,
    ).trim();
    const providerRequestId = this.stringValue(
      transaction.customIdentifier ||
        transaction.customIdentifierId ||
        data?.customIdentifier ||
        body.customIdentifier ||
        transaction.referenceId ||
        data?.referenceId ||
        body.referenceId,
    ).trim();
    const status = this.stringValue(
      transaction.status || data?.status || body.status,
    )
      .trim()
      .toLowerCase();

    if (!eventType || !providerReference || !status) {
      throw new BadRequestException("Invalid Reloadly webhook payload");
    }

    return {
      eventType,
      eventId: this.stringValue(body.id || body.eventId || body.notificationId)
        .trim()
        .slice(0, 128),
      providerReference,
      providerRequestId: providerRequestId || undefined,
      status,
      message:
        this.stringValue(transaction.message || data?.message || body.message)
          .trim()
          .slice(0, 500) || undefined,
      rawPayload: body,
    };
  }

  private objectValue(value: unknown): Record<string, unknown> | undefined {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return undefined;
  }

  private stringValue(value: unknown) {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "bigint") {
      return value.toString();
    }

    return "";
  }

  private timingSafeCompare(expected: string, received: string) {
    const normalizedReceived = received.replace(/^sha256=/i, "").trim();
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(normalizedReceived);

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }
}
