import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  type TransactionStatus,
  type TransactionType,
} from '@prisma/client';
import { WalletsService } from '../wallets/wallets.service';
import { VtuApiProvider } from './providers/vtu-api.provider';
import {
  PurchaseVtuDto,
  ValidateMeterDto,
  ValidateSmartCardDto,
} from './dto/vtu.dto';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../wallets/ledger.service';
import { maskAccountNumber, maskPhone } from '../common/utils/masking';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { formatKycTier, isKycTierAtLeast } from '../common/utils/kyc-tier';
import { VtuProviderHealthResponse } from './providers/provider-health.types';
import type { VtuProviderResult } from './providers/vtpass.types';
import type { VtpassInboxEvent } from './vtu-webhook-inbox.service';
import { VtuReceiptService } from './vtu-receipt.service';

type VtuPricingContext = {
  amount: Decimal;
  countryCode: string;
  serviceType: TransactionType;
  provider: string;
  scope: 'LOCAL';
};

@Injectable()
export class VtuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly vtuApi: VtuApiProvider,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly ledger: LedgerService,
    private readonly transactionPin: TransactionPinService,
    private readonly receipt: VtuReceiptService,
  ) {}

  async getProviders(type?: string) {
    this.assertVtuEnabled();
    return this.vtuApi.getProviders(type);
  }

  async getPackages(provider: string) {
    this.assertVtuEnabled();
    return this.vtuApi.getPackages(provider);
  }

  async getProviderHealth(): Promise<VtuProviderHealthResponse> {
    const vtpass = await this.vtuApi.getVtpassHealth();

    return {
      generatedAt: new Date(),
      providers: [vtpass],
    };
  }

  async processVtpassWebhookEvent(event: VtpassInboxEvent) {
    try {
      const order = await this.prisma.vtuOrder.findFirst({
        where: {
          provider: 'VTPASS',
          OR: [
            { providerRequestId: event.providerRequestId },
            ...(event.providerReference
              ? [{ providerTransactionId: event.providerReference }]
              : []),
          ],
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
              metadata: true,
            },
          },
        },
      });

      if (!order) {
        this.logger.warn(
          { providerRequestId: event.providerRequestId },
          'VTpass webhook VTU order not found',
        );
        throw new NotFoundException('VTU order not found for callback');
      }

      await this.applyProviderResultToOrder({
        order,
        result: {
          reference: event.providerReference || event.providerRequestId,
          providerTransactionId:
            event.providerReference || event.providerRequestId,
          status: event.status,
          message: event.message || 'VTpass webhook status update',
          providerRequestId: event.providerRequestId,
          safeResponse: {
            code: event.code,
            status: event.status,
          },
          rawResponse: {
            code: event.code,
            status: event.status,
          },
        },
      });

      this.logger.info(
        {
          providerRequestId: event.providerRequestId,
          providerReference: event.providerReference,
          status: event.status,
          orderId: order.id,
        },
        'VTpass webhook VTU order processed',
      );

      return { processed: true, orderId: order.id, status: event.status };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown VTpass webhook error';
      this.logger.error(
        { providerRequestId: event.providerRequestId, errorMessage },
        'VTpass webhook VTU processing failed',
      );
      throw error;
    }
  }

  async validateSmartCard(dto: ValidateSmartCardDto) {
    this.assertVtuEnabled();
    return this.vtuApi.validateSmartCard(dto.provider, dto.smartCardNumber);
  }

  async validateMeter(dto: ValidateMeterDto) {
    this.assertVtuEnabled();
    return this.vtuApi.validateMeter(
      dto.provider,
      dto.meterNumber,
      dto.meterType,
    );
  }

  async purchase(userId: string, dto: PurchaseVtuDto) {
    this.assertVtuEnabled();
    await this.transactionPin.verifyRequired(userId, dto.transactionPin);
    await this.assertUserCanPurchase(userId);
    this.assertRequiredTarget(dto);
    await this.assertProviderSupportsType(dto);

    const verification = await this.verifyCustomerForPurchase(dto);
    const amount = await this.resolveServerAmount(dto, verification);
    const wallet = await this.walletsService.getWallet(userId, 'NGN');
    if (!wallet) {
      throw new NotFoundException('NGN wallet not found');
    }

    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be positive');
    }

    if (amount.lessThan(50) || amount.greaterThan(1_000_000)) {
      throw new BadRequestException('Amount must be between 50 and 1000000');
    }

    const pricing = await this.calculatePricingForPurchase(dto, amount);
    const debitAmount = amount.plus(pricing.fee);
    const reference = `VTU-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const metadata = {
      ...this.buildSafeMetadata(dto),
      ...verification,
      pricingRuleId: pricing.ruleId,
      fixedMargin: pricing.fixedMargin.toString(),
      percentMargin: pricing.percentMargin.toString(),
      marginFee: pricing.fee.toString(),
      debitAmount: debitAmount.toString(),
    };
    const provider = this.getOrderProvider();
    const providerRequestId = this.getProviderRequestId(reference);

    const transactionRecord = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: this.mapVtuType(dto.type),
          amount,
          currency: 'NGN',
          status: 'PENDING',
          reference,
          fee: pricing.fee,
          walletId: wallet.id,
          metadata,
        },
      });

      await this.ledger.debitWallet(
        {
          userId,
          currency: 'NGN',
          amount: debitAmount,
          transactionId: transaction.id,
          reference,
          source: 'VTU_PURCHASE',
          metadata,
        },
        tx,
      );

      const order = await tx.vtuOrder.create({
        data: {
          transactionId: transaction.id,
          provider,
          scope: 'LOCAL',
          serviceType: this.mapVtuType(dto.type),
          countryCode: 'NG',
          localProvider: this.getLocalProvider(dto),
          providerRequestId,
          status: 'PENDING',
          amount,
          currency: 'NGN',
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
      purchaseResult = await this.vtuApi.purchase({
        type: dto.type,
        provider: this.getLocalProvider(dto),
        contactPhone: dto.contactPhone,
        recipientNumber: dto.recipientNumber,
        amount: amount.toFixed(2),
        reference,
        packageId: dto.packageId,
        smartCardNumber: dto.smartCardNumber,
        subscriptionType: dto.subscriptionType,
        meterNumber: dto.meterNumber,
        meterType: dto.meterType,
        providerRequestId,
      });
    } catch (error) {
      await this.markProviderResultUnknown(transactionRecord, {
        ...metadata,
        providerStatus: 'UNKNOWN',
        providerError:
          error instanceof Error ? error.message : 'Unknown VTU provider error',
      });

      this.logger.warn(
        {
          userId,
          reference,
          error:
            error instanceof Error
              ? error.message
              : 'Unknown VTU provider error',
        },
        'VTU provider result unknown, purchase left pending',
      );

      return {
        success: false,
        status: 'PENDING',
        reference: transactionRecord.reference,
        orderId: transactionRecord.orderId,
        message:
          'VTU purchase submitted and pending provider confirmation. Funds remain reserved until verification completes.',
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
        status: 'PENDING',
        reference: transactionRecord.reference,
        orderId: transactionRecord.orderId,
        message:
          purchaseResult.message ||
          'VTU purchase is pending provider confirmation.',
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
          ? 'REVERSED'
          : 'FAILED',
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
        status: 'PENDING',
        reference: transactionRecord.reference,
        orderId: transactionRecord.orderId,
        message:
          'VTU purchase submitted and pending provider confirmation. Funds remain reserved until verification completes.',
        amount: amount.toString(),
        fee: pricing.fee.toString(),
        totalDebit: debitAmount.toString(),
      };
    }

    await this.applyProviderResultToOrder({
      order: {
        id: transactionRecord.orderId,
        transactionId: transactionRecord.id,
        providerRequestId,
        transaction: {
          id: transactionRecord.id,
          userId,
          reference: transactionRecord.reference,
          amount,
          fee: pricing.fee,
          currency: 'NGN',
          status: 'PENDING',
          metadata,
        },
      },
      result: purchaseResult,
    });

    this.logger.info(
      {
        userId,
        reference,
        type: dto.type,
        provider: this.getLocalProvider(dto),
        amount: dto.amount,
      },
      'VTU purchase successful',
    );

    return {
      success: true,
      reference: transactionRecord.reference,
      orderId: transactionRecord.orderId,
      status: 'SUCCESS',
      message: purchaseResult.message,
      amount: amount.toString(),
      fee: pricing.fee.toString(),
      totalDebit: debitAmount.toString(),
      ...this.receipt.toOwnerReceipt(
        this.receipt.encryptPurchasedCode(purchaseResult.purchasedCode),
      ),
    };
  }

  async calculatePricingForPurchase(dto: PurchaseVtuDto, amount: Decimal) {
    return this.calculateVtuPricing({
      amount,
      countryCode: 'NG',
      serviceType: this.mapVtuType(dto.type),
      provider: this.getPricingProvider(dto),
      scope: 'LOCAL',
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
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
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
        status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] },
        OR: [{ nextRequeryAt: null }, { nextRequeryAt: { lte: new Date() } }],
        requeryAttempts: { lt: 12 },
      },
      orderBy: [{ nextRequeryAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      // Only ids are used below; requeryOrder() re-fetches each order with the
      // transaction relation, so joining it here is wasted work per cron cycle.
      select: { id: true },
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
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'VTU order requery failed',
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
      throw new NotFoundException('VTU order not found');
    }

    if (['SUCCESS', 'FAILED', 'REVERSED'].includes(order.status)) {
      return { processed: false, terminal: true };
    }

    let result: VtuProviderResult;

    try {
      result = await this.vtuApi.requery(order.providerRequestId);
    } catch (error) {
      await this.scheduleOrderRequery(
        order.id,
        error instanceof Error ? error.message : 'Unknown requery error',
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
        throw new NotFoundException('VTU order not found');
      }

      return this.toOrderStatusResponse(byTransaction);
    }

    return this.toOrderStatusResponse(order);
  }

  private async assertUserCanPurchase(userId: string) {
    if (this.isVtuKycBypassEnabled()) {
      return;
    }

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
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('Account is suspended');
    }

    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException('KYC verification is required');
    }

    if (!isKycTierAtLeast(user.kycTier, 'TIER_2')) {
      throw new ForbiddenException(
        `KYC ${formatKycTier('TIER_2')} is required for VTU purchases`,
      );
    }
  }

  private isVtuKycBypassEnabled() {
    const configured = this.configService.get<unknown>('VTU_KYC_BYPASS');
    return configured === true || configured === 'true';
  }

  private assertVtuEnabled() {
    const configured = this.configService.get<unknown>('VTU_ENABLED');
    if (configured === false || configured === 'false') {
      throw new ServiceUnavailableException(
        'VTU services are temporarily unavailable',
      );
    }
  }

  private assertRequiredTarget(dto: PurchaseVtuDto) {
    if (
      (dto.type === 'airtime' || dto.type === 'data') &&
      !dto.recipientNumber
    ) {
      throw new BadRequestException('Recipient phone number is required');
    }

    if (dto.type === 'data' && !dto.packageId) {
      throw new BadRequestException('Data package is required');
    }

    if (dto.type === 'cable' && !dto.smartCardNumber) {
      throw new BadRequestException('Smart card number is required');
    }

    if (dto.type === 'cable' && !dto.subscriptionType) {
      throw new BadRequestException('Cable subscription type is required');
    }

    if (
      dto.type === 'cable' &&
      dto.subscriptionType === 'change' &&
      !dto.packageId
    ) {
      throw new BadRequestException('Cable package is required');
    }

    if (dto.type === 'electricity' && !dto.meterNumber) {
      throw new BadRequestException('Meter number is required');
    }

    if (dto.type === 'electricity' && !dto.meterType) {
      throw new BadRequestException('Meter type is required');
    }
  }

  /**
   * Electricity and cable purchases must re-verify the customer server-side
   * at purchase time; client-side validation alone can be skipped or spoofed
   * and a mistyped meter/smartcard would burn real funds.
   */
  private async verifyCustomerForPurchase(dto: PurchaseVtuDto) {
    if (dto.type === 'cable') {
      const customer = await this.vtuApi.validateSmartCard(
        this.getLocalProvider(dto),
        dto.smartCardNumber as string,
      );
      return {
        verifiedCustomerName: this.safeCustomerField(customer.name),
        verifiedCustomerStatus: this.safeCustomerField(customer.status),
        verifiedRenewalAmount: customer.renewalAmount,
      };
    }

    if (dto.type === 'electricity') {
      const customer = await this.vtuApi.validateMeter(
        this.getLocalProvider(dto),
        dto.meterNumber as string,
        dto.meterType,
      );
      return {
        verifiedCustomerName: this.safeCustomerField(customer.name),
        verifiedCustomerAddress: this.safeCustomerField(customer.address),
      };
    }

    return {};
  }

  private safeCustomerField(value: string | undefined) {
    const trimmed = (value ?? '').trim();
    return trimmed ? trimmed.slice(0, 120) : undefined;
  }

  private async assertProviderSupportsType(dto: PurchaseVtuDto) {
    const providers = await this.vtuApi.getProviders(dto.type);
    const provider = providers.find(
      (item) =>
        item.id === this.getLocalProvider(dto) &&
        item.isActive &&
        (item.type === dto.type ||
          (dto.type === 'data' && item.type === 'airtime')),
    );

    if (!provider) {
      throw new BadRequestException(
        'Unsupported VTU provider for service type',
      );
    }
  }

  private async resolveServerAmount(
    dto: PurchaseVtuDto,
    verification: { verifiedRenewalAmount?: string },
  ) {
    const amount = new Decimal(dto.amount);

    if (dto.type === 'cable' && dto.subscriptionType === 'renew') {
      if (!verification.verifiedRenewalAmount) {
        throw new BadRequestException(
          'Provider did not return a valid cable renewal amount',
        );
      }

      const renewalAmount = new Decimal(verification.verifiedRenewalAmount);
      if (!amount.equals(renewalAmount)) {
        throw new BadRequestException('Cable renewal price mismatch');
      }
      return renewalAmount;
    }

    if (dto.type !== 'data' && dto.type !== 'cable') {
      return amount;
    }

    const packages = await this.vtuApi.getPackages(this.getLocalProvider(dto));
    const selectedPackage = packages.find((item) => item.id === dto.packageId);

    if (!selectedPackage) {
      throw new BadRequestException('Invalid VTU package');
    }

    if (selectedPackage.serviceType !== dto.type) {
      throw new BadRequestException('Invalid VTU package');
    }

    const packagePrice = new Decimal(selectedPackage.price);
    if (!amount.equals(packagePrice)) {
      throw new BadRequestException('Package price mismatch');
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
          status: 'UNKNOWN',
          providerStatus: 'UNKNOWN',
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
          providerTransactionId:
            result.providerTransactionId || result.reference,
          providerStatus: result.status,
          costAmount: this.optionalDecimal(result.providerCost),
          providerCommission: this.optionalDecimal(result.providerCommission),
          purchasedCodeEncrypted: this.receipt.encryptPurchasedCode(
            result.purchasedCode,
          ),
          rawResponse: (result.safeResponse || result.rawResponse) as
            | Prisma.InputJsonValue
            | undefined,
          nextRequeryAt: this.nextRequeryAt(),
        },
      });
    });
  }

  private async scheduleOrderRequery(orderId: string, reason: string) {
    await this.prisma.vtuOrder.update({
      where: { id: orderId },
      data: {
        status: 'UNKNOWN',
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
        currency: 'NGN' | 'GHS';
        status: TransactionStatus;
        metadata?: Prisma.JsonValue;
      };
    };
    result: VtuProviderResult;
  }) {
    const orderStatus = this.orderStatusFromProviderStatus(input.result.status);
    const metadata = {
      ...this.asMetadata(input.order.transaction.metadata),
      providerReference: input.result.reference,
      providerStatus: input.result.status,
      providerRequestId:
        input.result.providerRequestId || input.order.providerRequestId,
    };

    if (orderStatus === 'SUCCESS') {
      await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.transaction.updateMany({
          where: { id: input.order.transactionId, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            metadata,
          },
        });

        if (transitioned.count !== 1) return;

        await tx.vtuOrder.update({
          where: { id: input.order.id },
          data: {
            status: 'SUCCESS',
            providerTransactionId:
              input.result.providerTransactionId || input.result.reference,
            providerStatus: input.result.status,
            costAmount: this.optionalDecimal(input.result.providerCost),
            providerCommission: this.optionalDecimal(
              input.result.providerCommission,
            ),
            purchasedCodeEncrypted: this.receipt.encryptPurchasedCode(
              input.result.purchasedCode,
            ),
            rawResponse: (input.result.safeResponse ||
              input.result.rawResponse) as Prisma.InputJsonValue | undefined,
            requeryAttempts: { increment: 1 },
            lastRequeryAt: new Date(),
            nextRequeryAt: null,
            completedAt: new Date(),
          },
        });
      });
      return;
    }

    if (orderStatus === 'FAILED' || orderStatus === 'REVERSED') {
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

    await this.prisma.vtuOrder.updateMany({
      where: {
        id: input.order.id,
        status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] },
      },
      data: {
        status: orderStatus,
        providerTransactionId:
          input.result.providerTransactionId || input.result.reference,
        providerStatus: input.result.status,
        costAmount: this.optionalDecimal(input.result.providerCost),
        providerCommission: this.optionalDecimal(
          input.result.providerCommission,
        ),
        purchasedCodeEncrypted: this.receipt.encryptPurchasedCode(
          input.result.purchasedCode,
        ),
        rawResponse: (input.result.safeResponse || input.result.rawResponse) as
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
    finalStatus: Extract<TransactionStatus, 'FAILED' | 'REVERSED'> = 'FAILED',
  ) {
    const reversed = await this.prisma.$transaction(async (tx) => {
      // Guarded transition: only a still-PENDING purchase may be reversed.
      // A late FAILED/REVERSED provider event after the order was already
      // delivered (SUCCESS) or refunded (REVERSED) must not double-refund.
      const transitioned = await tx.transaction.updateMany({
        where: { reference: transaction.reference, status: 'PENDING' },
        data: {
          status: finalStatus,
          metadata: {
            ...metadata,
            reversalReason: reason,
          },
        },
      });

      if (transitioned.count !== 1) {
        return false;
      }

      const existingReversal = await tx.ledgerEntry.findFirst({
        where: {
          transactionId: transaction.id,
          source: 'VTU_REVERSAL',
        },
      });

      if (!existingReversal) {
        await this.ledger.creditWallet(
          {
            userId,
            currency: 'NGN',
            amount,
            transactionId: transaction.id,
            reference: `${transaction.reference}-REVERSAL`,
            source: 'VTU_REVERSAL',
            metadata: {
              ...metadata,
              reversalReason: reason,
            },
          },
          tx,
        );
      }

      if (transaction.orderId) {
        await tx.vtuOrder.update({
          where: { id: transaction.orderId },
          data: {
            status: finalStatus,
            providerTransactionId:
              typeof metadata.providerReference === 'string'
                ? metadata.providerReference
                : undefined,
            providerStatus:
              typeof metadata.providerStatus === 'string'
                ? metadata.providerStatus
                : undefined,
            failedAt: new Date(),
            nextRequeryAt: null,
          },
        });
      }

      return true;
    });

    if (!reversed) {
      this.logger.info(
        { userId, reference: transaction.reference },
        'VTU reversal skipped; transaction already terminal',
      );
      return;
    }

    this.logger.info(
      { userId, reference: transaction.reference, amount: amount.toString() },
      'VTU purchase reversed, balance restored',
    );
  }

  private isSuccessfulProviderStatus(status: string) {
    return [
      'success',
      'successful',
      'completed',
      'complete',
      'delivered',
      'completed-api',
    ].includes(status.toLowerCase());
  }

  private isPendingProviderStatus(status: string) {
    return [
      'pending',
      'processing',
      'initiated',
      'queued',
      'processing-api',
      'initiated-api',
      'queued-api',
      'unknown',
    ].includes(status.toLowerCase());
  }

  private isFailedProviderStatus(status: string) {
    return [
      'failed',
      'failure',
      'rejected',
      'cancelled',
      'canceled',
      'refunded',
      'reversed',
      'not_processed',
    ].includes(status.toLowerCase());
  }

  private isProviderReversalStatus(status: string) {
    return ['refunded', 'reversed'].includes(status.toLowerCase());
  }

  private orderStatusFromProviderStatus(status: string) {
    if (this.isSuccessfulProviderStatus(status)) {
      return 'SUCCESS';
    }

    if (this.isProviderReversalStatus(status)) {
      return 'REVERSED';
    }

    if (this.isFailedProviderStatus(status)) {
      return 'FAILED';
    }

    if (this.isPendingProviderStatus(status)) {
      return ['processing', 'initiated', 'queued'].includes(
        status.toLowerCase(),
      )
        ? 'PROCESSING'
        : 'PENDING';
    }

    return 'UNKNOWN';
  }

  private buildSafeMetadata(dto: PurchaseVtuDto) {
    return {
      vtuType: dto.type,
      scope: 'local',
      provider: this.getLocalProvider(dto),
      countryCode: 'NG',
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
      airtime: 'AIRTIME',
      data: 'DATA',
      cable: 'CABLE',
      electricity: 'ELECTRICITY',
    };

    return typeMap[type] || 'AIRTIME';
  }

  private getLocalProvider(dto: PurchaseVtuDto) {
    if (!dto.provider) {
      throw new BadRequestException('Provider is required');
    }

    return dto.provider;
  }

  private getOrderProvider() {
    return 'VTPASS' as const;
  }

  private getPricingProvider(dto: PurchaseVtuDto) {
    return this.getLocalProvider(dto);
  }

  private getProviderRequestId(reference: string) {
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
    fee: Decimal | null;
    currency: string;
    targetMasked: string | null;
    purchasedCodeEncrypted: string | null;
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
    const fee = order.fee ? new Decimal(order.fee) : new Decimal(0);
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
      fee: fee.toString(),
      totalDebit: new Decimal(order.amount).plus(fee).toString(),
      currency: order.currency,
      targetMasked: order.targetMasked,
      requeryAttempts: order.requeryAttempts,
      lastRequeryAt: order.lastRequeryAt,
      nextRequeryAt: order.nextRequeryAt,
      completedAt: order.completedAt,
      failedAt: order.failedAt,
      createdAt: order.transaction.createdAt,
      updatedAt: order.transaction.updatedAt,
      ...this.receipt.toOwnerReceipt(order.purchasedCodeEncrypted),
    };
  }

  private optionalDecimal(value?: string) {
    return value ? new Decimal(value) : undefined;
  }

  private asMetadata(value?: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  }
}
