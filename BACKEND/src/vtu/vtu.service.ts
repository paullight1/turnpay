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
  VtuQuoteDto,
  EXTENDED_VTU_PROVIDERS,
  isSmile,
  needsPackage,
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
import { SettlementHoldService } from '../common/services/settlement-hold.service';

type VtuPricingContext = {
  amount: Decimal;
  countryCode: string;
  serviceType: TransactionType;
  provider: string;
  scope: 'LOCAL' | 'INTERNATIONAL';
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
    private readonly settlementHold: SettlementHoldService,
  ) {}

  async getProviders(type?: string, extended = false) {
    this.assertVtuEnabled();
    const providers = await this.vtuApi.getProviders(type);
    return extended
      ? providers
      : providers.filter(
          (provider) => !EXTENDED_VTU_PROVIDERS.has(provider.id),
        );
  }

  async getPackages(
    provider: string,
    options: { countryCode?: string; operatorId?: string } = {},
  ) {
    this.assertVtuEnabled();
    return this.vtuApi.getPackages(provider, options);
  }

  async getInternationalCountries() {
    this.assertVtuEnabled();
    return this.vtuApi.getInternationalCountries();
  }
  async getInternationalOperators(countryCode: string) {
    this.assertVtuEnabled();
    return this.vtuApi.getInternationalOperators(countryCode);
  }
  async validateSmile(email: string) {
    this.assertVtuEnabled();
    return this.vtuApi.validateSmile(email);
  }

  async quote(dto: VtuQuoteDto) {
    this.assertVtuEnabled();
    await this.assertProviderSupportsType(dto);
    const amount = await this.resolvePackageAmount(dto);
    this.assertAmountLimits(amount);
    const pricing = await this.calculatePricingForPurchase(dto, amount);
    return {
      amount: amount.toFixed(2),
      fee: pricing.fee.toFixed(2),
      totalDebit: amount.plus(pricing.fee).toFixed(2),
      currency: 'NGN',
    };
  }

  private assertAmountLimits(amount: Decimal) {
    if (
      !amount.isFinite() ||
      amount.lt(50) ||
      amount.gt(1000000) ||
      amount.decimalPlaces() > 2
    )
      throw new BadRequestException(
        'Amount must be between 50 and 1000000 with at most 2 decimal places',
      );
  }

  private async resolvePackageAmount(dto: {
    provider: string;
    type: string;
    countryCode?: string;
    operatorId?: string;
    packageId?: string;
    faceValue?: string;
  }) {
    const packages = await this.vtuApi.getPackages(dto.provider, {
      countryCode: dto.countryCode,
      operatorId: dto.operatorId,
    });
    const plan = packages.find(
      (item) => item.id === dto.packageId && item.serviceType === dto.type,
    );
    if (!plan) throw new BadRequestException('Invalid VTU package');
    if (dto.provider === 'foreign-airtime' && plan.fixedPrice === false) {
      if (!dto.faceValue || !plan.rate)
        throw new BadRequestException('Destination airtime amount is required');
      const face = new Decimal(dto.faceValue);
      if (
        !face.isFinite() ||
        face.lte(0) ||
        face.decimalPlaces() > 2 ||
        (plan.minFaceValue && face.lt(plan.minFaceValue)) ||
        (plan.maxFaceValue && face.gt(plan.maxFaceValue))
      )
        throw new BadRequestException(
          'Destination amount is outside provider limits',
        );
      const charge = face.mul(plan.rate);
      this.assertAmountLimits(charge);
      return charge;
    }
    return new Decimal(plan.price);
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
          providerRequestId: event.providerRequestId,
        },
        select: {
          id: true,
          transactionId: true,
          providerRequestId: true,
          providerTransactionId: true,
          status: true,
          costAmount: true,
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

      if (order.providerRequestId !== event.providerRequestId) {
        throw new BadRequestException('VTU provider request identity mismatch');
      }

      const isLateReversal =
        order.transaction.status === 'SUCCESS' && event.status === 'reversed';
      if (order.transaction.status !== 'PENDING' && !isLateReversal) {
        return { processed: false, orderId: order.id, terminal: true };
      }

      // The gateway signature authenticates transport, not the provider outcome.
      // Only the authenticated provider requery can settle or refund this order.
      // Errors propagate to the durable inbox for retry without moving money.
      const result = await this.vtuApi.requery(order.providerRequestId);

      if (isLateReversal && result.status !== 'reversed') {
        // A signed reversal callback is an authenticated trigger, not proof
        // of the final provider state. Keep the inbox row retryable when the
        // first requery is stale so a later confirmed reversal is not lost.
        throw new Error('VTU provider reversal not yet confirmed');
      }

      await this.applyProviderResultToOrder({
        order,
        result:
          isLateReversal && result.status === 'reversed'
            ? {
                ...result,
                // VTpass documents wallet_credit_id on the signed reversal
                // callback, while some requery responses omit it. Keep the
                // requery authoritative for status/identity and use callback
                // evidence only to complete the provider reversal reference.
                walletCreditId: result.walletCreditId || event.walletCreditId,
                providerAmount: result.providerAmount || event.providerAmount,
                providerCurrency:
                  result.providerCurrency || event.providerCurrency,
              }
            : result,
      });

      this.logger.info(
        {
          providerRequestId: event.providerRequestId,
          providerReference: event.providerReference,
          status: result.status,
          orderId: order.id,
        },
        'VTpass webhook VTU order processed',
      );

      return { processed: true, orderId: order.id, status: result.status };
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
    const customer = await this.vtuApi.validateSmartCard(
      dto.provider,
      dto.smartCardNumber,
    );
    if (dto.subscriptionType === 'renew' && !customer.renewalAmount) {
      throw new BadRequestException(
        'Your TV provider has not supplied a renewal price. Choose Change package to select a priced plan, or try renewal again later.',
      );
    }
    return customer;
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
    this.assertAmountLimits(amount);
    let buyerEmail: string | undefined;
    if (dto.provider === 'foreign-airtime') {
      const countries = await this.vtuApi.getInternationalCountries();
      const destination = countries.find(
        (country) => country.code === dto.countryCode,
      );
      if (
        !destination ||
        !dto.recipientNumber?.startsWith(`+${destination.prefix}`)
      )
        throw new BadRequestException(
          'Recipient does not match destination country',
        );
      const buyer = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!buyer?.email)
        throw new BadRequestException(
          'An account email is required for international airtime',
        );
      buyerEmail = buyer.email;
    }
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
    if (dto.expectedTotal && !debitAmount.equals(dto.expectedTotal))
      throw new BadRequestException(
        'Total price changed. Review a fresh quote before paying.',
      );
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
          scope: dto.provider === 'foreign-airtime' ? 'INTERNATIONAL' : 'LOCAL',
          serviceType: this.mapVtuType(dto.type),
          countryCode:
            dto.provider === 'foreign-airtime' ? dto.countryCode : 'NG',
          operatorId:
            dto.provider === 'foreign-airtime' ? dto.operatorId : undefined,
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
        currency: transaction.currency || 'NGN',
      };
    });

    try {
      await this.settlementHold.assertOutboundAllowed({
        operation: 'VTU',
        scope: 'VTU_SETTLEMENT',
        currency: 'NGN',
        reference: transactionRecord.reference,
      });
    } catch (error) {
      await this.reverseVtuPurchase(
        userId,
        transactionRecord,
        debitAmount,
        'VTU settlement blocked by reconciliation hold',
        {
          ...metadata,
          providerStatus: 'BLOCKED_RECONCILIATION',
        },
        'FAILED',
      );
      throw error;
    }

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
        smileAccountId: dto.smileAccountId,
        countryCode: dto.countryCode,
        operatorId: dto.operatorId,
        faceValue:
          dto.provider === 'foreign-airtime' ? dto.faceValue : undefined,
        email: buyerEmail,
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

  async calculatePricingForPurchase(
    dto: { type: string; provider: string; countryCode?: string },
    amount: Decimal,
  ) {
    return this.calculateVtuPricing({
      amount,
      countryCode:
        dto.provider === 'foreign-airtime' ? dto.countryCode || 'NG' : 'NG',
      serviceType: this.mapVtuType(dto.type),
      provider: this.getPricingProvider(dto),
      scope: dto.provider === 'foreign-airtime' ? 'INTERNATIONAL' : 'LOCAL',
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

    if (['FAILED', 'REVERSED'].includes(order.status)) {
      return { processed: false, terminal: true };
    }

    const locallySuccessful =
      order.status === 'SUCCESS' || order.transaction.status === 'SUCCESS';

    let result: VtuProviderResult;

    try {
      result = await this.vtuApi.requery(order.providerRequestId);
    } catch (error) {
      if (!locallySuccessful) {
        await this.scheduleOrderRequery(
          order.id,
          error instanceof Error ? error.message : 'Unknown requery error',
        );
      }
      throw error;
    }

    if (locallySuccessful && result.status !== 'reversed') {
      return { processed: false, terminal: true };
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
      !isSmile(dto.provider) &&
      (dto.type === 'airtime' ||
        dto.type === 'data' ||
        dto.provider === 'showmax') &&
      !dto.recipientNumber
    ) {
      throw new BadRequestException('Recipient phone number is required');
    }

    if (needsPackage(dto) && !dto.packageId) {
      throw new BadRequestException('Data package is required');
    }

    if (
      dto.type === 'cable' &&
      dto.provider !== 'showmax' &&
      !dto.smartCardNumber
    ) {
      throw new BadRequestException('Smart card number is required');
    }

    if (
      dto.type === 'cable' &&
      dto.provider !== 'showmax' &&
      !dto.subscriptionType
    ) {
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
    if (isSmile(dto.provider)) {
      if (!dto.smileEmail || !dto.smileAccountId)
        throw new BadRequestException('Smile account and email are required');
      const customer = await this.vtuApi.validateSmile(dto.smileEmail);
      if (
        !customer.accounts.some((account) => account.id === dto.smileAccountId)
      )
        throw new BadRequestException(
          'Smile account does not belong to this email',
        );
      return { verifiedCustomerName: this.safeCustomerField(customer.name) };
    }
    if (dto.provider === 'showmax') return {};
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

  private async assertProviderSupportsType(dto: {
    provider: string;
    type: string;
  }) {
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

    if (
      dto.type === 'cable' &&
      dto.provider !== 'showmax' &&
      dto.subscriptionType === 'renew'
    ) {
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

    if (!needsPackage(dto)) return amount;
    const packagePrice = await this.resolvePackageAmount(dto);
    if (!amount.equals(packagePrice))
      throw new BadRequestException(
        'Package price mismatch. Refresh your quote before paying.',
      );
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
      providerTransactionId?: string | null;
      status?: string;
      costAmount?: Decimal | null;
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
    const isLateReversal =
      input.order.transaction.status === 'SUCCESS' &&
      orderStatus === 'REVERSED';

    this.assertProviderRequestIdentity(
      input.order,
      input.result,
      isLateReversal,
    );
    if (isLateReversal) {
      this.assertConfirmedLateReversal(input.order, input.result);
    }

    const providerAmount = this.providerAmount(input.result);
    const providerCurrency = this.providerCurrency(input.result);
    const walletCreditId = this.walletCreditId(input.result);
    const metadata = {
      ...this.asMetadata(input.order.transaction.metadata),
      providerReference: input.result.reference,
      providerStatus: input.result.status,
      providerRequestId:
        input.result.providerRequestId || input.order.providerRequestId,
      ...(isLateReversal && input.result.providerTransactionId
        ? { providerTransactionId: input.result.providerTransactionId }
        : {}),
      ...(providerAmount ? { providerAmount } : {}),
      ...(providerCurrency ? { providerCurrency } : {}),
      ...(walletCreditId ? { walletCreditId } : {}),
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
          currency: input.order.transaction.currency,
        },
        new Decimal(input.order.transaction.amount).plus(
          input.order.transaction.fee,
        ),
        input.result.message,
        metadata,
        orderStatus,
        isLateReversal ? 'SUCCESS' : 'PENDING',
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

  private assertProviderRequestIdentity(
    order: { providerRequestId: string },
    result: VtuProviderResult,
    required: boolean,
  ) {
    if (!required) return;

    if (
      !result.providerRequestId ||
      result.providerRequestId !== order.providerRequestId
    ) {
      throw new BadRequestException('VTU provider request identity mismatch');
    }
  }

  private assertConfirmedLateReversal(
    order: {
      providerRequestId: string;
      providerTransactionId?: string | null;
      costAmount?: Decimal | null;
      transaction: {
        amount: Decimal;
        currency: 'NGN' | 'GHS';
      };
    },
    result: VtuProviderResult,
  ) {
    if (result.status !== 'reversed') {
      throw new BadRequestException('VTU provider reversal was not confirmed');
    }

    const resultTransactionId =
      result.providerTransactionId || result.reference;
    if (
      !resultTransactionId ||
      (order.providerTransactionId &&
        resultTransactionId !== order.providerTransactionId)
    ) {
      throw new BadRequestException(
        'VTU provider transaction identity mismatch',
      );
    }

    const providerCurrency = this.providerCurrency(result);
    if (providerCurrency !== order.transaction.currency) {
      throw new BadRequestException('VTU provider reversal currency mismatch');
    }

    const providerAmount = this.providerAmount(result);
    if (!providerAmount) {
      throw new BadRequestException('VTU provider reversal amount is missing');
    }

    let normalizedProviderAmount: Decimal;
    try {
      normalizedProviderAmount = new Decimal(providerAmount);
    } catch {
      throw new BadRequestException('VTU provider reversal amount is invalid');
    }
    if (
      !normalizedProviderAmount.isFinite() ||
      normalizedProviderAmount.lessThanOrEqualTo(0)
    ) {
      throw new BadRequestException('VTU provider reversal amount is invalid');
    }

    const expectedProviderAmounts = [
      order.costAmount ? new Decimal(order.costAmount) : undefined,
      new Decimal(order.transaction.amount),
    ].filter((amount): amount is Decimal => Boolean(amount));
    if (
      !expectedProviderAmounts.some((amount) =>
        normalizedProviderAmount.equals(amount),
      )
    ) {
      throw new BadRequestException('VTU provider reversal amount mismatch');
    }

    if (!this.walletCreditId(result)) {
      throw new BadRequestException(
        'VTU provider reversal wallet credit is missing',
      );
    }
  }

  private providerAmount(result: VtuProviderResult) {
    const value =
      result.providerAmount ??
      result.providerCost ??
      this.safeResponseValue(result, ['providerAmount', 'amount']);
    return this.optionalMoneyString(value);
  }

  private providerCurrency(result: VtuProviderResult) {
    const value =
      result.providerCurrency ??
      this.safeResponseValue(result, ['providerCurrency', 'currency']);
    return value === 'NGN' || value === 'GHS' ? value : undefined;
  }

  private walletCreditId(result: VtuProviderResult) {
    const value =
      result.walletCreditId ??
      this.safeResponseValue(result, ['walletCreditId', 'wallet_credit_id']);
    return typeof value === 'string' && value.trim()
      ? value.trim().slice(0, 128)
      : undefined;
  }

  private safeResponseValue(result: VtuProviderResult, keys: string[]) {
    for (const key of keys) {
      const value = result.safeResponse?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  }

  private optionalMoneyString(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    try {
      const normalized = new Decimal(value as string | number);
      if (!normalized.isFinite() || normalized.isNegative()) return undefined;
      return normalized.toFixed(2);
    } catch {
      return undefined;
    }
  }

  private async reverseVtuPurchase(
    userId: string,
    transaction: {
      id: string;
      reference: string;
      currency: 'NGN' | 'GHS';
      orderId?: string;
    },
    amount: Decimal,
    reason: string,
    metadata: Record<string, unknown>,
    finalStatus: Extract<TransactionStatus, 'FAILED' | 'REVERSED'> = 'FAILED',
    expectedStatus: Extract<
      TransactionStatus,
      'PENDING' | 'SUCCESS'
    > = 'PENDING',
  ) {
    const reversed = await this.prisma.$transaction(async (tx) => {
      // Guarded transition: an outright failure only reverses a pending
      // purchase, while a provider-confirmed reversal may also reverse a
      // locally successful purchase. The guarded write makes duplicate and
      // concurrent callbacks no-ops.
      const transitioned = await tx.transaction.updateMany({
        where: { reference: transaction.reference, status: expectedStatus },
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
            currency: transaction.currency,
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
      scope: dto.provider === 'foreign-airtime' ? 'international' : 'local',
      provider: this.getLocalProvider(dto),
      countryCode: dto.provider === 'foreign-airtime' ? dto.countryCode : 'NG',
      operatorId:
        dto.provider === 'foreign-airtime' ? dto.operatorId : undefined,
      smileAccountMasked:
        isSmile(dto.provider) && dto.smileAccountId
          ? maskAccountNumber(dto.smileAccountId)
          : undefined,
      faceValue: dto.provider === 'foreign-airtime' ? dto.faceValue : undefined,
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

  private getLocalProvider(dto: { provider: string }) {
    if (!dto.provider) {
      throw new BadRequestException('Provider is required');
    }

    return dto.provider;
  }

  private getOrderProvider() {
    return 'VTPASS' as const;
  }

  private getPricingProvider(dto: { provider: string }) {
    return this.getLocalProvider(dto);
  }

  private getProviderRequestId(reference: string) {
    return this.vtuApi.createProviderRequestId(reference);
  }

  private getTargetMasked(dto: PurchaseVtuDto) {
    if (isSmile(dto.provider) && dto.smileAccountId)
      return maskAccountNumber(dto.smileAccountId);
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
