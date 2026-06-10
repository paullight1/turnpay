import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  BadRequestException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { PaymentService } from "../payment.service";
import { PinoLogger } from "nestjs-pino";
import { Throttle } from "@nestjs/throttler";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { BankingService } from "../../banking/banking.service";
import type { RawBodyRequest } from "../../common/types/request-context";
import { ConfigService } from "@nestjs/config";
import { ExchangeService } from "../../exchange/exchange.service";
import { PrismaService } from "../../prisma/prisma.service";

interface PaystackWebhookEvent {
  event: string;
  data: {
    reference: string;
    status: string;
    amount: number;
    currency: string;
    gateway_response: string;
    id: number;
    authorization?: {
      receiver_bank_account_number?: string;
    };
  };
}

interface FlutterwaveWebhookEvent {
  event: string;
  data: {
    id: number;
    tx_ref: string;
    reference?: string;
    status: string;
    amount: number;
    currency: string;
    account_number?: string;
    customer?: {
      account_number?: string;
    };
  };
}

interface MonnifyWebhookEvent {
  eventType: string;
  eventData?: {
    transactionReference?: string;
    paymentReference?: string;
    amountPaid?: number;
    totalPayable?: number;
    settlementAmount?: number;
    currency?: string;
    paymentStatus?: string;
    destinationAccountInformation?: {
      accountNumber?: string;
      accountName?: string;
      bankCode?: string;
      bankName?: string;
    };
    product?: {
      reference?: string;
      type?: string;
    };
  };
}

@Controller("webhooks")
export class WebhookController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly bankingService: BankingService,
    private readonly exchangeService: ExchangeService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
  ) {}

  @Post("paystack")
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handlePaystackWebhook(
    @Headers("x-paystack-signature") signature: string,
    @Req() req: RawBodyRequest,
    @Body() body: PaystackWebhookEvent,
  ) {
    const rawBody = req.rawBody;

    if (!signature) {
      this.logger.warn("Missing Paystack webhook signature");
      throw new BadRequestException("Missing signature header");
    }

    if (!rawBody) {
      this.logger.warn("Missing raw body for Paystack webhook");
      throw new BadRequestException("Missing request body");
    }

    const isValid = this.paymentService.verifyPaystackSignature(
      rawBody,
      signature,
    );

    if (!isValid) {
      this.logger.warn("Invalid Paystack webhook signature");
      throw new BadRequestException("Invalid signature");
    }

    this.logger.info(
      { event: body.event, reference: body.data?.reference },
      "Paystack webhook received",
    );

    if (body.event?.startsWith("transfer.") && body.data?.reference) {
      await this.paymentService.processTransferWebhook({
        provider: "paystack",
        eventType: body.event,
        providerReference: body.data.reference,
        providerStatus: body.data.status,
        rawPayload: body as unknown as Record<string, unknown>,
      });
    } else if (body.event === "charge.success" && body.data?.reference) {
      await this.paymentService.processWebhookDeposit({
        provider: "paystack",
        eventType: body.event,
        reference: body.data.reference,
        status: body.data.status,
        amount: body.data.amount / 100,
        currency: body.data.currency || "NGN",
        rawPayload: body as unknown as Record<string, unknown>,
      });
    }

    return { received: true };
  }

  @Post("flutterwave")
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleFlutterwaveWebhook(
    @Headers("verif-hash") verifHash: string,
    @Headers("flw-signature") flwSignature: string,
    @Req() req: RawBodyRequest,
    @Body() body: FlutterwaveWebhookEvent,
  ) {
    const rawBody = req.rawBody;

    if (flwSignature && rawBody) {
      const isValid = this.paymentService.verifyFlutterwaveSignature(
        rawBody,
        flwSignature,
      );

      if (!isValid) {
        this.logger.warn("Invalid Flutterwave webhook signature");
        throw new BadRequestException("Invalid signature");
      }
    } else if (verifHash) {
      const isValid =
        this.paymentService.verifyFlutterwaveSecretHash(verifHash);

      if (!isValid) {
        this.logger.warn("Invalid Flutterwave webhook secret hash");
        throw new BadRequestException("Invalid signature");
      }
    } else {
      throw new BadRequestException("Missing webhook verification headers");
    }

    this.logger.info(
      { event: body.event, tx_ref: body.data?.tx_ref },
      "Flutterwave webhook received",
    );

    const transferReference = body.data?.reference || body.data?.tx_ref;

    if (body.event?.startsWith("transfer") && transferReference) {
      await this.paymentService.processTransferWebhook({
        provider: "flutterwave",
        eventType: body.event,
        providerReference: transferReference,
        providerStatus: body.data.status,
        rawPayload: body as unknown as Record<string, unknown>,
      });
    } else if (body.event === "charge.completed" && body.data?.tx_ref) {
      await this.paymentService.processWebhookDeposit({
        provider: "flutterwave",
        eventType: body.event,
        reference: body.data.tx_ref,
        status: body.data.status,
        amount: body.data.amount,
        currency: body.data.currency,
        rawPayload: body as unknown as Record<string, unknown>,
      });
    }

    return { received: true };
  }

  @Post("monnify")
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleMonnifyWebhook(
    @Headers("monnify-signature") signature: string,
    @Req() req: RawBodyRequest,
    @Body() body: MonnifyWebhookEvent,
  ) {
    const rawBody = req.rawBody;

    if (!signature) {
      this.logger.warn("Missing Monnify webhook signature");
      throw new BadRequestException("Missing signature header");
    }

    if (!rawBody) {
      this.logger.warn("Missing raw body for Monnify webhook");
      throw new BadRequestException("Missing request body");
    }

    if (
      !this.verifyHmacHex(
        "sha512",
        rawBody,
        signature,
        "MONNIFY_WEBHOOK_SECRET",
      )
    ) {
      this.logger.warn("Invalid Monnify webhook signature");
      throw new BadRequestException("Invalid signature");
    }

    const eventType = body.eventType;
    const data = body.eventData;
    const providerReference =
      data?.transactionReference || data?.paymentReference;
    const accountNumber = data?.destinationAccountInformation?.accountNumber;
    const amount = data?.amountPaid ?? data?.totalPayable;
    const currency = data?.currency || "NGN";
    const paymentStatus = data?.paymentStatus;

    this.logger.info(
      { event: eventType, reference: providerReference },
      "Monnify webhook received",
    );

    // Log every received webhook for audit trail and debugging
    try {
      await this.prisma.webhookLog.create({
        data: {
          provider: "MONNIFY",
          eventType: eventType || "UNKNOWN",
          reference: providerReference || `unknown-${Date.now()}`,
          payload: body as unknown as Prisma.InputJsonValue,
          processed: false,
        },
      });
    } catch (logError) {
      // Reference must be unique — duplicate webhook deliveries
      // should not crash the handler
      this.logger.warn(
        { error: logError, reference: providerReference },
        "Failed to create webhook log entry (likely duplicate reference)",
      );
    }

    if (
      eventType === "SUCCESSFUL_TRANSACTION" &&
      paymentStatus === "PAID" &&
      providerReference &&
      accountNumber &&
      amount
    ) {
      try {
        const exchangeResult =
          await this.exchangeService.processMonnifyExchangeDepositWebhook({
            eventType,
            providerReference,
            paymentReference: data?.paymentReference,
            accountNumber,
            amount: new Decimal(amount),
            currency: currency as "NGN" | "GHS",
            rawPayload: body as unknown as Record<string, unknown>,
          });

        if (exchangeResult.matched) {
          // Mark webhook log as processed
          await this.prisma.webhookLog
            .update({
              where: { reference: providerReference },
              data: { processed: true },
            })
            .catch(() => {});

          return { received: true, routed: "exchange" };
        }

        await this.bankingService.processVirtualAccountDeposit({
          provider: "monnify",
          eventType,
          providerReference,
          accountNumber,
          amount: new Decimal(amount),
          currency: currency as "NGN" | "GHS",
          rawPayload: body as unknown as Record<string, unknown>,
        });

        // Mark webhook log as processed
        await this.prisma.webhookLog
          .update({
            where: { reference: providerReference },
            data: { processed: true },
          })
          .catch(() => {});
      } catch (processingError) {
        const errorMessage =
          processingError instanceof Error
            ? processingError.message
            : "Unknown processing error";

        this.logger.error(
          { error: processingError, reference: providerReference },
          "Failed to process Monnify webhook",
        );

        // Update webhook log with error
        await this.prisma.webhookLog
          .update({
            where: { reference: providerReference },
            data: { errorMessage },
          })
          .catch(() => {});
      }
    }

    return { received: true };
  }

  private verifyHmacHex(
    algorithm: "sha512",
    rawBody: string,
    receivedSignature: string,
    secretEnvName: string,
  ) {
    const secret =
      this.configService.get<string>(secretEnvName) ||
      (secretEnvName === "MONNIFY_WEBHOOK_SECRET"
        ? this.configService.getOrThrow<string>("MONNIFY_SECRET_KEY")
        : this.configService.getOrThrow<string>(secretEnvName));
    const expected = createHmac(algorithm, secret)
      .update(rawBody)
      .digest("hex");

    return this.timingSafeCompare(expected, receivedSignature);
  }

  private timingSafeCompare(expected: string, received: string) {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }
}
