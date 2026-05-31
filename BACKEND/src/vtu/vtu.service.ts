import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  Prisma,
  type TransactionStatus,
  type TransactionType,
} from "@prisma/client";
import { WalletsService } from "../wallets/wallets.service";
import { VtuApiProvider } from "./providers/vtu-api.provider";
import { ReloadlyProvider } from "./providers/reloadly.provider";
import { AutoDetectReloadlyOperatorDto, PurchaseVtuDto } from "./dto/vtu.dto";
import { v4 as uuidv4 } from "uuid";
import { PinoLogger } from "nestjs-pino";
import { Decimal } from "@prisma/client/runtime/library";
import { LedgerService } from "../wallets/ledger.service";
import { maskAccountNumber, maskPhone } from "../common/utils/masking";
import { TransactionPinService } from "../common/services/transaction-pin.service";
import { formatKycTier, isKycTierAtLeast } from "../common/utils/kyc-tier";
import { VtuProviderHealthResponse } from "./providers/provider-health.types";

type VtuProviderResult = {
  reference: string;
  status: string;
  message: string;
  providerRequestId?: string;
  rawResponse?: Record<string, unknown>;
};

type ReloadlyWebhookEvent = {
  eventType: string;
  eventId?: string;
  providerReference: string;
  providerRequestId?: string;
  status: string;
  message?: string;
  rawPayload: Record<string, unknown>;
};

type VtuPricingContext = {
  amount: Decimal;
  countryCode: string;
  serviceType: TransactionType;
  provider: string;
  scope: "LOCAL" | "INTERNATIONAL";
};

@Injectable()
export class VtuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly vtuApi: VtuApiProvider,
    private readonly reloadly: ReloadlyProvider,
    private readonly logger: PinoLogger,
    private readonly ledger: LedgerService,
    private readonly transactionPin: TransactionPinService,
  ) {}

  async getProviders(type?: string, scope?: string, countryCode?: string) {
    if (scope === "international") {
      if (type && !["airtime", "data", "electricity"].includes(type)) {
        throw new BadRequestException(
          "International VTU currently supports airtime, data, and Ghana electricity only",
        );
      }

      if (type === "electricity") {
        return this.reloadly.getUtilityBillers(countryCode, "electricity");
      }

      return this.reloadly.getOperators(
        countryCode,
        type === "data" ? "data" : "airtime",
      );
    }

    return this.vtuApi.getProviders(type);
  }

  async getPackages(provider: string) {
    return this.vtuApi.getPackages(provider);
  }

  async autoDetectReloadlyOperator(dto: AutoDetectReloadlyOperatorDto) {
    return this.reloadly.autoDetectOperator({
      phone: dto.phone,
      countryCode: dto.countryCode,
      type: dto.type,
    });
  }

  async getReloadlyTopupStatus(transactionId: string) {
    return this.reloadly.getTopupStatus(transactionId);
  }

  async getProviderHealth(): Promise<VtuProviderHealthResponse> {
    const [vtpass, reloadly] = await Promise.all([
      this.vtuApi.getVtpassHealth(),
      this.reloadly.getHealth(),
    ]);

    return {
      generatedAt: new Date(),
      providers: [vtpass, reloadly],
    };
  }

  async recordReloadlyWebhookEvent(event: ReloadlyWebhookEvent) {
    const reference = this.reloadlyWebhookReference(event);

    try {
      const log = await this.prisma.webhookLog.create({
        data: {
          provider: "reloadly",
          eventType: event.eventType,
          reference,
          payload: event.rawPayload as Prisma.InputJsonValue,
          processed: false,
        },
        select: { id: true, reference: true },
      });

      return { duplicate: false, logId: log.id, reference: log.reference };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return { duplicate: true, reference };
      }

      throw error;
    }
  }

  async processReloadlyWebhookEvent(event: ReloadlyWebhookEvent) {
    const reference = this.reloadlyWebhookReference(event);
    const log = await this.prisma.webhookLog.findUnique({
      where: { reference },
    });

    if (log?.processed) {
      return { processed: false, duplicate: true };
    }

    try {
      const orderFilters: Prisma.VtuOrderWhereInput[] = [
        { providerTransactionId: event.providerReference },
        { providerRequestId: event.providerReference },
      ];

      if (event.providerRequestId) {
        orderFilters.push(
          { providerRequestId: event.providerRequestId },
          { transaction: { reference: event.providerRequestId } },
        );
      }

      const order = await this.prisma.vtuOrder.findFirst({
        where: {
          provider: "RELOADLY",
          OR: orderFilters,
        },
        select: {
          id: true,
          transactionId: true,
          providerRequestId: true,
          transaction: {
            select: {
              id: true,
              userId: true,
              reference: true,
              amount: true,
              fee: true,
              currency: true,
              status: true,
            },
          },
        },
      });

      if (!order) {
        await this.markReloadlyWebhookLog(
          reference,
          false,
          "VTU order not found",
        );
        this.logger.warn(
          { reference, providerReference: event.providerReference },
          "Reloadly webhook VTU order not found",
        );
        return { processed: false, orderFound: false };
      }

      await this.applyProviderResultToOrder({
        order,
        result: {
          reference: event.providerReference,
          status: event.status,
          message: event.message || "Reloadly webhook status update",
          providerRequestId: event.providerRequestId,
          rawResponse: event.rawPayload,
        },
      });

      await this.markReloadlyWebhookLog(reference, true);

      this.logger.info(
        {
          reference,
          providerReference: event.providerReference,
          status: event.status,
          orderId: order.id,
        },
        "Reloadly webhook VTU order processed",
      );

      return { processed: true, orderId: order.id, status: event.status };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown Reloadly webhook error";
      await this.markReloadlyWebhookLog(reference, false, errorMessage);
      this.logger.error(
        { reference, providerReference: event.providerReference, errorMessage },
        "Reloadly webhook VTU processing failed",
      );
      throw error;
    }
  }

  async validateSmartCard(provider: string, smartCardNumber: string) {
    return this.vtuApi.validateSmartCard(provider, smartCardNumber);
  }

  async validateMeter(provider: string, meterNumber: string) {
    return this.vtuApi.validateMeter(provider, meterNumber);
  }

  async purchase(userId: string, dto: PurchaseVtuDto) {
    await this.transactionPin.verifyRequired(userId, dto.transactionPin);
    await this.assertUserCanPurchase(userId);
    this.assertRequiredTarget(dto);
    await this.assertProviderSupportsType(dto);

    const amount = await this.resolveServerAmount(dto);
    const wallet = await this.walletsService.getWallet(userId, "NGN");
    if (!wallet) {
      throw new NotFoundException("NGN wallet not found");
    }

    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException("Amount must be positive");
    }

    if (amount.lessThan(50) || amount.greaterThan(1_000_000)) {
      throw new BadRequestException("Amount must be between 50 and 1000000");
    }

    const pricing = await this.calculatePricingForPurchase(dto, amount);
    const debitAmount = amount.plus(pricing.fee);
    if (new Decimal(wallet.balance).lessThan(debitAmount)) {
      throw new BadRequestException(
        `Insufficient NGN balance. Required: ${debitAmount.toString()}`,
      );
    }

    const reference = `VTU-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const metadata = {
      ...this.buildSafeMetadata(dto),
      pricingRuleId: pricing.ruleId,
      fixedMargin: pricing.fixedMargin.toString(),
      percentMargin: pricing.percentMargin.toString(),
      marginFee: pricing.fee.toString(),
      debitAmount: debitAmount.toString(),
    };
    const provider = this.getOrderProvider(dto);
    const providerRequestId = this.getProviderRequestId(dto, reference);

    const transactionRecord = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: this.mapVtuType(dto.type),
          amount,
          currency: "NGN",
          status: "PENDING",
          reference,
          fee: pricing.fee,
          walletId: wallet.id,
          metadata,
        },
      });

      await this.ledger.debitWallet(
        {
          userId,
          currency: "NGN",
          amount: debitAmount,
          transactionId: transaction.id,
          reference,
          source: "VTU_PURCHASE",
          metadata,
        },
        tx,
      );

      const order = await tx.vtuOrder.create({
        data: {
          transactionId: transaction.id,
          provider,
          scope: this.isInternationalPurchase(dto) ? "INTERNATIONAL" : "LOCAL",
          serviceType: this.mapVtuType(dto.type),
          countryCode: this.isInternationalPurchase(dto)
            ? dto.countryCode
            : "NG",
          localProvider: this.isInternationalPurchase(dto)
            ? undefined
            : this.getLocalProvider(dto),
          operatorId: dto.operatorId,
          providerRequestId,
          status: "PENDING",
          amount,
          currency: "NGN",
          costAmount: amount,
          fee: pricing.fee,
          margin: pricing.fee,
          targetMasked: this.getTargetMasked(dto),
          metadata,
          nextRequeryAt: this.nextRequeryAt(),
        },
      });

      return {
        id: transaction.id,
        reference: transaction.reference,
        orderId: order.id,
      };
    });

    let purchaseResult: VtuProviderResult;

    try {
      if (this.isInternationalPurchase(dto)) {
        purchaseResult =
          dto.type === "electricity"
            ? await this.reloadly.payUtilityBill({
                type: "electricity",
                billerId: dto.operatorId as string,
                countryCode: dto.countryCode as string,
                meterNumber: dto.meterNumber as string,
                amount: amount.toNumber(),
                reference,
              })
            : await this.reloadly.purchase({
                type: dto.type as "airtime" | "data",
                operatorId: dto.operatorId as string,
                countryCode: dto.countryCode as string,
                recipientNumber: dto.recipientNumber as string,
                amount: amount.toNumber(),
                reference,
              });
      } else {
        purchaseResult = await this.vtuApi.purchase({
          type: dto.type,
          provider: this.getLocalProvider(dto),
          recipientNumber: dto.recipientNumber,
          amount: amount.toNumber(),
          reference,
          packageId: dto.packageId,
          smartCardNumber: dto.smartCardNumber,
          meterNumber: dto.meterNumber,
          providerRequestId,
        });
      }
    } catch (error) {
      await this.markProviderResultUnknown(transactionRecord, {
        ...metadata,
        providerStatus: "UNKNOWN",
        providerError:
          error instanceof Error ? error.message : "Unknown VTU provider error",
      });

      this.logger.warn(
        {
          userId,
          reference,
          error:
            error instanceof Error
              ? error.message
              : "Unknown VTU provider error",
        },
        "VTU provider result unknown, purchase left pending",
      );

      return {
        success: false,
        status: "PENDING",
        reference: transactionRecord.reference,
        orderId: transactionRecord.orderId,
        message:
          "VTU purchase submitted and pending provider confirmation. Funds remain reserved until verification completes.",
        amount: amount.toString(),
        fee: pricing.fee.toString(),
        totalDebit: debitAmount.toString(),
      };
    }

    if (this.isPendingProviderStatus(purchaseResult.status)) {
      await this.markProviderResultPending(
        transactionRecord,
        purchaseResult,
        metadata,
      );

      return {
        success: false,
        status: "PENDING",
        reference: transactionRecord.reference,
        orderId: transactionRecord.orderId,
        message:
          purchaseResult.message ||
          "VTU purchase is pending provider confirmation.",
        amount: amount.toString(),
        fee: pricing.fee.toString(),
        totalDebit: debitAmount.toString(),
      };
    }

    if (this.isFailedProviderStatus(purchaseResult.status)) {
      await this.reverseVtuPurchase(
        userId,
        transactionRecord,
        debitAmount,
        purchaseResult.message,
        {
          ...metadata,
          providerReference: purchaseResult.reference,
          providerStatus: purchaseResult.status,
        },
        this.isProviderReversalStatus(purchaseResult.status)
          ? "REVERSED"
          : "FAILED",
      );
      throw new BadRequestException(
        `VTU purchase failed: ${purchaseResult.message}`,
      );
    }

    if (!this.isSuccessfulProviderStatus(purchaseResult.status)) {
      await this.markProviderResultPending(
        transactionRecord,
        purchaseResult,
        metadata,
      );

      return {
        success: false,
        status: "PENDING",
        reference: transactionRecord.reference,
        orderId: transactionRecord.orderId,
        message:
          "VTU purchase submitted and pending provider confirmation. Funds remain reserved until verification completes.",
        amount: amount.toString(),
        fee: pricing.fee.toString(),
        totalDebit: debitAmount.toString(),
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { reference: transactionRecord.reference },
        data: {
          status: "SUCCESS",
          metadata: {
            ...metadata,
            providerReference: purchaseResult.reference,
            providerStatus: purchaseResult.status,
          },
        },
      });

      await tx.vtuOrder.update({
        where: { id: transactionRecord.orderId },
        data: {
          status: "SUCCESS",
          providerTransactionId: purchaseResult.reference,
          providerStatus: purchaseResult.status,
          rawResponse: purchaseResult.rawResponse as
            | Prisma.InputJsonValue
            | undefined,
          completedAt: new Date(),
          nextRequeryAt: null,
        },
      });
    });

    this.logger.info(
      {
        userId,
        reference,
        type: dto.type,
        provider: this.isInternationalPurchase(dto)
          ? "reloadly"
          : this.getLocalProvider(dto),
        amount: dto.amount,
      },
      "VTU purchase successful",
    );

    return {
      success: true,
      reference: transactionRecord.reference,
      orderId: transactionRecord.orderId,
      status: "SUCCESS",
      message: purchaseResult.message,
      amount: amount.toString(),
      fee: pricing.fee.toString(),
      totalDebit: debitAmount.toString(),
    };
  }

  async calculatePricingForPurchase(dto: PurchaseVtuDto, amount: Decimal) {
    return this.calculateVtuPricing({
      amount,
      countryCode: this.isInternationalPurchase(dto)
        ? (dto.countryCode as string)
        : "NG",
      serviceType: this.mapVtuType(dto.type),
      provider: this.getPricingProvider(dto),
      scope: this.isInternationalPurchase(dto) ? "INTERNATIONAL" : "LOCAL",
    });
  }

  async calculateVtuPricing(context: VtuPricingContext) {
    const rule = await this.prisma.vtuPricingRule.findFirst({
      where: {
        isActive: true,
        AND: [
          {
            OR: [{ countryCode: null }, { countryCode: context.countryCode }],
          },
          {
            OR: [{ serviceType: null }, { serviceType: context.serviceType }],
          },
          {
            OR: [{ provider: null }, { provider: context.provider }],
          },
          {
            OR: [{ scope: null }, { scope: context.scope }],
          },
          {
            OR: [{ minAmount: null }, { minAmount: { lte: context.amount } }],
          },
          {
            OR: [{ maxAmount: null }, { maxAmount: { gte: context.amount } }],
          },
        ],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    if (!rule) {
      return {
        ruleId: null,
        fixedMargin: new Decimal(0),
        percentMargin: new Decimal(0),
        fee: new Decimal(0),
      };
    }

    const fixedMargin = new Decimal(rule.fixedMargin);
    const percentMargin = new Decimal(rule.percentMargin);
    const percentFee = context.amount
      .mul(percentMargin)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const fee = fixedMargin.plus(percentFee).toDecimalPlaces(2);

    return {
      ruleId: rule.id,
      fixedMargin,
      percentMargin,
      fee,
    };
  }

  async requeryPendingOrders(limit = 25) {
    const orders = await this.prisma.vtuOrder.findMany({
      where: {
        status: { in: ["PENDING", "PROCESSING", "UNKNOWN"] },
        OR: [{ nextRequeryAt: null }, { nextRequeryAt: { lte: new Date() } }],
        requeryAttempts: { lt: 12 },
      },
      orderBy: [{ nextRequeryAt: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: { transaction: true },
    });

    const results: Array<{ orderId: string; processed: boolean }> = [];

    for (const order of orders) {
      try {
        await this.requeryOrder(order.id);
        results.push({ orderId: order.id, processed: true });
      } catch (error) {
        this.logger.warn(
          {
            orderId: order.id,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "VTU order requery failed",
        );
        results.push({ orderId: order.id, processed: false });
      }
    }

    return { checked: orders.length, results };
  }

  async requeryOrder(orderId: string) {
    const order = await this.prisma.vtuOrder.findUnique({
      where: { id: orderId },
      include: { transaction: true },
    });

    if (!order) {
      throw new NotFoundException("VTU order not found");
    }

    if (["SUCCESS", "FAILED", "REVERSED"].includes(order.status)) {
      return { processed: false, terminal: true };
    }

    let result: VtuProviderResult;

    try {
      if (order.provider === "RELOADLY") {
        if (!order.providerTransactionId) {
          await this.scheduleOrderRequery(
            order.id,
            "Awaiting provider reference",
          );
          return { processed: false, pendingProviderReference: true };
        }

        result =
          order.serviceType === "ELECTRICITY"
            ? await this.reloadly.requeryUtilityPayment(order.providerRequestId)
            : await this.reloadly.requery(order.providerTransactionId);
      } else {
        result = await this.vtuApi.requery(order.providerRequestId);
      }
    } catch (error) {
      await this.scheduleOrderRequery(
        order.id,
        error instanceof Error ? error.message : "Unknown requery error",
      );
      throw error;
    }

    await this.applyProviderResultToOrder({
      order,
      result,
    });

    return { processed: true, status: result.status };
  }

  async findOrderForAdmin(reference: string) {
    return this.prisma.vtuOrder.findFirst({
      where: {
        OR: [
          { id: reference },
          { providerRequestId: reference },
          { providerTransactionId: reference },
          { transaction: { reference } },
        ],
      },
      select: {
        id: true,
        provider: true,
        scope: true,
        serviceType: true,
        countryCode: true,
        localProvider: true,
        operatorId: true,
        providerRequestId: true,
        providerTransactionId: true,
        providerStatus: true,
        status: true,
        amount: true,
        currency: true,
        targetMasked: true,
        requeryAttempts: true,
        lastRequeryAt: true,
        nextRequeryAt: true,
        completedAt: true,
        failedAt: true,
        createdAt: true,
        updatedAt: true,
        transaction: {
          select: {
            id: true,
            userId: true,
            reference: true,
            status: true,
            amount: true,
            currency: true,
            type: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async getOrderStatus(userId: string, reference: string) {
    const order = await this.prisma.vtuOrder.findFirst({
      where: {
        OR: [{ id: reference }, { providerRequestId: reference }],
        transaction: { userId },
      },
      include: {
        transaction: {
          select: {
            id: true,
            reference: true,
            status: true,
            amount: true,
            currency: true,
            type: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!order) {
      const byTransaction = await this.prisma.vtuOrder.findFirst({
        where: {
          transaction: { reference, userId },
        },
        include: {
          transaction: {
            select: {
              id: true,
              reference: true,
              status: true,
              amount: true,
              currency: true,
              type: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!byTransaction) {
        throw new NotFoundException("VTU order not found");
      }

      return this.toOrderStatusResponse(byTransaction);
    }

    return this.toOrderStatusResponse(order);
  }

  private async assertUserCanPurchase(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.isSuspended) {
      throw new ForbiddenException("Account is suspended");
    }

    if (user.kycStatus !== "VERIFIED") {
      throw new ForbiddenException("KYC verification is required");
    }

    if (!isKycTierAtLeast(user.kycTier, "TIER_2")) {
      throw new ForbiddenException(
        `KYC ${formatKycTier("TIER_2")} is required for VTU purchases`,
      );
    }
  }

  private assertRequiredTarget(dto: PurchaseVtuDto) {
    if (this.isInternationalPurchase(dto)) {
      if (!["airtime", "data", "electricity"].includes(dto.type)) {
        throw new BadRequestException(
          dto.countryCode === "GH"
            ? "Ghana electricity and cable recharge are coming soon"
            : "International VTU currently supports airtime and data only",
        );
      }

      if (
        dto.type === "electricity" &&
        dto.countryCode &&
        dto.countryCode !== "GH"
      ) {
        throw new BadRequestException(
          "International electricity is currently available for Ghana only",
        );
      }

      if (!dto.countryCode || !dto.operatorId) {
        throw new BadRequestException("Country and operator are required");
      }

      if (dto.type === "electricity") {
        if (!dto.meterNumber) {
          throw new BadRequestException("Meter number is required");
        }
        return;
      }

      if (!dto.recipientNumber) {
        throw new BadRequestException("Recipient phone number is required");
      }

      return;
    }

    if (
      (dto.type === "airtime" || dto.type === "data") &&
      !dto.recipientNumber
    ) {
      throw new BadRequestException("Recipient phone number is required");
    }

    if (dto.type === "data" && !dto.packageId) {
      throw new BadRequestException("Data package is required");
    }

    if (dto.type === "cable" && !dto.smartCardNumber) {
      throw new BadRequestException("Smart card number is required");
    }

    if (dto.type === "electricity" && !dto.meterNumber) {
      throw new BadRequestException("Meter number is required");
    }
  }

  private async assertProviderSupportsType(dto: PurchaseVtuDto) {
    if (this.isInternationalPurchase(dto)) {
      this.reloadly.assertReadyForPurchase();
      return;
    }

    const providers = await this.vtuApi.getProviders(dto.type);
    const provider = providers.find(
      (item) =>
        item.id === this.getLocalProvider(dto) &&
        item.isActive &&
        (item.type === dto.type ||
          (dto.type === "data" && item.type === "airtime")),
    );

    if (!provider) {
      throw new BadRequestException(
        "Unsupported VTU provider for service type",
      );
    }
  }

  private async resolveServerAmount(dto: PurchaseVtuDto) {
    const amount = new Decimal(dto.amount);

    if (dto.type !== "data" || this.isInternationalPurchase(dto)) {
      return amount;
    }

    const packages = await this.vtuApi.getPackages(this.getLocalProvider(dto));
    const selectedPackage = packages.find((item) => item.id === dto.packageId);

    if (!selectedPackage) {
      throw new BadRequestException("Invalid VTU package");
    }

    const packagePrice = new Decimal(selectedPackage.price);
    if (!amount.equals(packagePrice)) {
      throw new BadRequestException("Package price mismatch");
    }

    return packagePrice;
  }

  private async markProviderResultUnknown(
    transaction: { reference: string; orderId: string },
    metadata: Record<string, unknown>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { reference: transaction.reference },
        data: {
          metadata: metadata as Prisma.InputJsonValue,
        },
      });

      await tx.vtuOrder.update({
        where: { id: transaction.orderId },
        data: {
          status: "UNKNOWN",
          providerStatus: "UNKNOWN",
          metadata: metadata as Prisma.InputJsonValue,
          lastRequeryAt: new Date(),
          nextRequeryAt: this.nextRequeryAt(),
        },
      });
    });
  }

  private async markProviderResultPending(
    transaction: { reference: string; orderId: string },
    result: VtuProviderResult,
    metadata: Record<string, unknown>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { reference: transaction.reference },
        data: {
          metadata: {
            ...metadata,
            providerReference: result.reference,
            providerStatus: result.status,
          },
        },
      });

      await tx.vtuOrder.update({
        where: { id: transaction.orderId },
        data: {
          status: this.orderStatusFromProviderStatus(result.status),
          providerTransactionId: result.reference,
          providerStatus: result.status,
          rawResponse: result.rawResponse as Prisma.InputJsonValue | undefined,
          nextRequeryAt: this.nextRequeryAt(),
        },
      });
    });
  }

  private async scheduleOrderRequery(orderId: string, reason: string) {
    await this.prisma.vtuOrder.update({
      where: { id: orderId },
      data: {
        status: "UNKNOWN",
        providerStatus: reason,
        requeryAttempts: { increment: 1 },
        lastRequeryAt: new Date(),
        nextRequeryAt: this.nextRequeryAt(),
      },
    });
  }

  private async applyProviderResultToOrder(input: {
    order: {
      id: string;
      transactionId: string;
      providerRequestId: string;
      transaction: {
        id: string;
        userId: string;
        reference: string;
        amount: Decimal;
        fee: Decimal;
        currency: "NGN" | "GHS";
        status: TransactionStatus;
      };
    };
    result: VtuProviderResult;
  }) {
    const orderStatus = this.orderStatusFromProviderStatus(input.result.status);
    const metadata = {
      providerReference: input.result.reference,
      providerStatus: input.result.status,
      providerRequestId:
        input.result.providerRequestId || input.order.providerRequestId,
    };

    if (orderStatus === "SUCCESS") {
      await this.prisma.$transaction(async (tx) => {
        await tx.transaction.updateMany({
          where: { id: input.order.transactionId, status: "PENDING" },
          data: {
            status: "SUCCESS",
            metadata,
          },
        });

        await tx.vtuOrder.update({
          where: { id: input.order.id },
          data: {
            status: "SUCCESS",
            providerTransactionId: input.result.reference,
            providerStatus: input.result.status,
            rawResponse: input.result.rawResponse as
              | Prisma.InputJsonValue
              | undefined,
            requeryAttempts: { increment: 1 },
            lastRequeryAt: new Date(),
            nextRequeryAt: null,
            completedAt: new Date(),
          },
        });
      });
      return;
    }

    if (orderStatus === "FAILED" || orderStatus === "REVERSED") {
      await this.reverseVtuPurchase(
        input.order.transaction.userId,
        {
          id: input.order.transaction.id,
          reference: input.order.transaction.reference,
          orderId: input.order.id,
        },
        new Decimal(input.order.transaction.amount).plus(
          input.order.transaction.fee,
        ),
        input.result.message,
        metadata,
        orderStatus,
      );
      return;
    }

    await this.prisma.vtuOrder.update({
      where: { id: input.order.id },
      data: {
        status: orderStatus,
        providerTransactionId: input.result.reference,
        providerStatus: input.result.status,
        rawResponse: input.result.rawResponse as
          | Prisma.InputJsonValue
          | undefined,
        requeryAttempts: { increment: 1 },
        lastRequeryAt: new Date(),
        nextRequeryAt: this.nextRequeryAt(),
      },
    });
  }

  private async reverseVtuPurchase(
    userId: string,
    transaction: { id: string; reference: string; orderId?: string },
    amount: Decimal,
    reason: string,
    metadata: Record<string, unknown>,
    finalStatus: Extract<TransactionStatus, "FAILED" | "REVERSED"> = "FAILED",
  ) {
    await this.prisma.$transaction(async (tx) => {
      const existingReversal = await tx.ledgerEntry.findFirst({
        where: {
          transactionId: transaction.id,
          source: "VTU_REVERSAL",
        },
      });

      if (!existingReversal) {
        await this.ledger.creditWallet(
          {
            userId,
            currency: "NGN",
            amount,
            transactionId: transaction.id,
            reference: `${transaction.reference}-REVERSAL`,
            source: "VTU_REVERSAL",
            metadata: {
              ...metadata,
              reversalReason: reason,
            },
          },
          tx,
        );
      }

      await tx.transaction.update({
        where: { reference: transaction.reference },
        data: {
          status: finalStatus,
          metadata: {
            ...metadata,
            reversalReason: reason,
          },
        },
      });

      if (transaction.orderId) {
        await tx.vtuOrder.update({
          where: { id: transaction.orderId },
          data: {
            status: finalStatus,
            providerTransactionId:
              typeof metadata.providerReference === "string"
                ? metadata.providerReference
                : undefined,
            providerStatus:
              typeof metadata.providerStatus === "string"
                ? metadata.providerStatus
                : undefined,
            failedAt: new Date(),
            nextRequeryAt: null,
          },
        });
      }
    });

    this.logger.info(
      { userId, reference: transaction.reference, amount: amount.toString() },
      "VTU purchase reversed, balance restored",
    );
  }

  private isSuccessfulProviderStatus(status: string) {
    return [
      "success",
      "successful",
      "completed",
      "complete",
      "delivered",
      "completed-api",
    ].includes(status.toLowerCase());
  }

  private isPendingProviderStatus(status: string) {
    return [
      "pending",
      "processing",
      "initiated",
      "queued",
      "processing-api",
      "initiated-api",
      "queued-api",
      "unknown",
    ].includes(status.toLowerCase());
  }

  private isFailedProviderStatus(status: string) {
    return [
      "failed",
      "failure",
      "rejected",
      "cancelled",
      "canceled",
      "refunded",
      "reversed",
      "not_processed",
    ].includes(status.toLowerCase());
  }

  private isProviderReversalStatus(status: string) {
    return ["refunded", "reversed"].includes(status.toLowerCase());
  }

  private orderStatusFromProviderStatus(status: string) {
    if (this.isSuccessfulProviderStatus(status)) {
      return "SUCCESS";
    }

    if (this.isProviderReversalStatus(status)) {
      return "REVERSED";
    }

    if (this.isFailedProviderStatus(status)) {
      return "FAILED";
    }

    if (this.isPendingProviderStatus(status)) {
      return ["processing", "initiated", "queued"].includes(
        status.toLowerCase(),
      )
        ? "PROCESSING"
        : "PENDING";
    }

    return "UNKNOWN";
  }

  private buildSafeMetadata(dto: PurchaseVtuDto) {
    return {
      vtuType: dto.type,
      scope: this.getScope(dto),
      provider: this.isInternationalPurchase(dto)
        ? "reloadly"
        : this.getLocalProvider(dto),
      countryCode: dto.countryCode,
      operatorId: dto.operatorId,
      recipientNumberMasked: dto.recipientNumber
        ? maskPhone(dto.recipientNumber)
        : undefined,
      packageId: dto.packageId,
      smartCardNumberMasked: dto.smartCardNumber
        ? maskAccountNumber(dto.smartCardNumber)
        : undefined,
      meterNumberMasked: dto.meterNumber
        ? maskAccountNumber(dto.meterNumber)
        : undefined,
    };
  }

  private mapVtuType(type: string): TransactionType {
    const typeMap: Record<string, TransactionType> = {
      airtime: "AIRTIME",
      data: "DATA",
      cable: "CABLE",
      electricity: "ELECTRICITY",
    };

    return typeMap[type] || "AIRTIME";
  }

  private isInternationalPurchase(dto: PurchaseVtuDto) {
    return this.getScope(dto) === "international";
  }

  private getScope(dto: PurchaseVtuDto) {
    return dto.scope || "local";
  }

  private getLocalProvider(dto: PurchaseVtuDto) {
    if (!dto.provider) {
      throw new BadRequestException("Provider is required");
    }

    return dto.provider;
  }

  private getOrderProvider(dto: PurchaseVtuDto) {
    if (this.isInternationalPurchase(dto)) {
      return "RELOADLY";
    }

    return this.vtuApi.getProviderName();
  }

  private getPricingProvider(dto: PurchaseVtuDto) {
    if (this.isInternationalPurchase(dto)) {
      return "reloadly";
    }

    return this.getLocalProvider(dto);
  }

  private getProviderRequestId(dto: PurchaseVtuDto, reference: string) {
    if (this.isInternationalPurchase(dto)) {
      return reference;
    }

    return this.vtuApi.createProviderRequestId(reference);
  }

  private getTargetMasked(dto: PurchaseVtuDto) {
    if (dto.recipientNumber) {
      return maskPhone(dto.recipientNumber);
    }

    if (dto.smartCardNumber) {
      return maskAccountNumber(dto.smartCardNumber);
    }

    if (dto.meterNumber) {
      return maskAccountNumber(dto.meterNumber);
    }

    return undefined;
  }

  private nextRequeryAt(delayMs = 5 * 60 * 1000) {
    return new Date(Date.now() + delayMs);
  }

  private reloadlyWebhookReference(event: ReloadlyWebhookEvent) {
    const eventKey =
      event.eventId ||
      `${event.eventType}:${event.providerReference}:${event.status}`;
    return `reloadly:${eventKey}`;
  }

  private async markReloadlyWebhookLog(
    reference: string,
    processed: boolean,
    errorMessage?: string,
  ) {
    await this.prisma.webhookLog.update({
      where: { reference },
      data: {
        processed,
        errorMessage,
      },
    });
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
  }

  private toOrderStatusResponse(order: {
    id: string;
    provider: string;
    scope: string;
    serviceType: string;
    countryCode: string | null;
    localProvider: string | null;
    operatorId: string | null;
    providerRequestId: string;
    providerTransactionId: string | null;
    providerStatus: string | null;
    status: string;
    amount: Decimal;
    currency: string;
    targetMasked: string | null;
    requeryAttempts: number;
    lastRequeryAt: Date | null;
    nextRequeryAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    transaction: {
      id: string;
      reference: string;
      status: string;
      amount: Decimal;
      currency: string;
      type: string;
      createdAt: Date;
      updatedAt: Date;
    };
  }) {
    return {
      orderId: order.id,
      transactionId: order.transaction.id,
      reference: order.transaction.reference,
      transactionStatus: order.transaction.status,
      orderStatus: order.status,
      provider: order.provider,
      scope: order.scope,
      type: order.serviceType,
      countryCode: order.countryCode,
      localProvider: order.localProvider,
      operatorId: order.operatorId,
      providerRequestId: order.providerRequestId,
      providerTransactionId: order.providerTransactionId,
      providerStatus: order.providerStatus,
      amount: order.amount.toString(),
      currency: order.currency,
      targetMasked: order.targetMasked,
      requeryAttempts: order.requeryAttempts,
      lastRequeryAt: order.lastRequeryAt,
      nextRequeryAt: order.nextRequeryAt,
      completedAt: order.completedAt,
      failedAt: order.failedAt,
      createdAt: order.transaction.createdAt,
      updatedAt: order.transaction.updatedAt,
    };
  }
}
