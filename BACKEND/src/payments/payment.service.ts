import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { WalletsService } from "../wallets/wallets.service";
import { PaystackProvider } from "./providers/paystack.provider";
import { FlutterwaveProvider } from "./providers/flutterwave.provider";
import { FundWalletDto, WithdrawDto, ResolveBankDto } from "./dto/payment.dto";
import { v4 as uuidv4 } from "uuid";
import { createHmac, timingSafeEqual } from "crypto";
import { PinoLogger } from "nestjs-pino";
import { UsersService } from "../users/users.service";
import { Prisma, Transaction, TransactionStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { LedgerService } from "../wallets/ledger.service";
import { MonnifyVirtualAccountProvider } from "../banking/providers/monnify-virtual-account.provider";
import { decryptSensitiveValue } from "../common/utils/encryption";
import { maskAccountNumber } from "../common/utils/masking";
import { TransactionPinService } from "../common/services/transaction-pin.service";
import { formatKycTier, isKycTierAtLeast } from "../common/utils/kyc-tier";
import {
  fromMinorUnit,
  toMinorUnit,
  toProviderDecimalString,
} from "./utils/provider-amount";

type WithdrawalProvider = "monnify";
type PaymentProviderName = "paystack" | "flutterwave";

interface WithdrawalDestination {
  beneficiaryId?: string;
  provider?: WithdrawalProvider;
  bankCode: string;
  bankName?: string;
  accountName: string;
  accountNumber: string;
  accountNumberMasked: string;
}

interface WithdrawalRecord {
  id: string;
  reference: string;
  amount: Decimal;
  currency: string;
  status: TransactionStatus;
  metadata: unknown;
  transferAttempts: Array<{
    id: string;
    providerReference: string;
    providerStatus: string;
    status: string;
    attemptNo: number;
    lastCheckedAt: Date | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly usersService: UsersService,
    private readonly paystack: PaystackProvider,
    private readonly flutterwave: FlutterwaveProvider,
    private readonly monnifyBanks: MonnifyVirtualAccountProvider,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly httpService: HttpService,
    private readonly ledger: LedgerService,
    private readonly transactionPin: TransactionPinService,
  ) {}

  async fundWallet(userId: string, dto: FundWalletDto) {
    const user = await this.usersService.findOne(userId);
    const reference = `FUND-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const provider = dto.provider || this.getDefaultProvider(dto.currency);
    const amount = new Decimal(dto.amount);
    this.assertAmountWithinLimit(amount);

    const email = dto.email || user.email;
    const callbackUrl = this.buildPaymentCallbackUrl();
    const channel = dto.channel || "card";
    const initialMetadata = {
      provider,
      channel,
      callbackUrl,
      providerInitStatus: "PENDING",
    };

    await this.prisma.transaction.create({
      data: {
        userId,
        type: "FUND",
        amount,
        currency: dto.currency,
        status: "PENDING",
        reference,
        metadata: initialMetadata,
      },
    });

    let paymentResult: {
      paymentUrl: string;
      reference: string;
      providerTransactionId?: number;
    };

    try {
      if (provider === "paystack") {
        const result = await this.paystack.initializePayment({
          amountMinor: toMinorUnit(amount),
          email,
          currency: dto.currency,
          reference,
          callbackUrl,
        });
        paymentResult = {
          paymentUrl: result.data.authorization_url,
          reference: result.data.reference,
        };
      } else {
        const result = await this.flutterwave.initializePayment({
          amount: toProviderDecimalString(amount),
          email,
          currency: dto.currency,
          txRef: reference,
          redirectUrl: callbackUrl,
        });
        paymentResult = {
          paymentUrl: result.paymentUrl,
          reference,
          providerTransactionId: result.transactionId,
        };
      }
    } catch (error: unknown) {
      await this.prisma.transaction.update({
        where: { reference },
        data: {
          status: "FAILED",
          metadata: this.mergeJsonMetadata(initialMetadata, {
            providerInitStatus: "FAILED",
            providerErrorCode: "PROVIDER_INITIALIZATION_FAILED",
          }) as Prisma.InputJsonValue,
        },
      });

      this.logger.warn(
        {
          userId,
          reference,
          provider,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Fund wallet provider initialization failed",
      );

      throw error;
    }

    await this.prisma.transaction.update({
      where: { reference },
      data: {
        metadata: this.mergeJsonMetadata(initialMetadata, {
          providerInitStatus: "INITIALIZED",
          paymentUrl: paymentResult.paymentUrl,
          providerReference: paymentResult.reference,
          providerTransactionId: paymentResult.providerTransactionId,
        }) as Prisma.InputJsonValue,
      },
    });

    this.logger.info(
      {
        userId,
        reference,
        amount: amount.toString(),
        currency: dto.currency,
        provider,
      },
      "Fund wallet initiated",
    );

    return {
      reference,
      paymentUrl: paymentResult.paymentUrl,
      message: "Complete payment to fund your wallet",
    };
  }

  async verifyPayment(reference: string, userId?: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { reference },
    });

    if (!transaction || (userId && transaction.userId !== userId)) {
      throw new NotFoundException("Transaction not found");
    }

    if (transaction.status !== "PENDING") {
      return {
        status: transaction.status,
        message: `Transaction already ${transaction.status.toLowerCase()}`,
      };
    }

    const metadata = transaction.metadata as Record<string, unknown>;
    const provider = this.normalizePaymentProvider(
      (metadata?.provider as string) || "paystack",
    );
    const providerTxId = metadata?.providerTransactionId as number;

    if (provider === "paystack") {
      const verification = await this.paystack.verifyPayment(reference);

      if (verification.status === "success") {
        await this.processVerifiedDeposit(transaction, {
          provider,
          reference: verification.reference,
          status: verification.status,
          amount: fromMinorUnit(verification.amount),
          currency: verification.currency,
          source: "PAYSTACK_VERIFY",
        });
      }
    } else if (providerTxId) {
      const verification = await this.flutterwave.verifyPayment(providerTxId);

      if (verification.status === "successful") {
        await this.processVerifiedDeposit(transaction, {
          provider,
          reference: verification.tx_ref,
          status: verification.status,
          amount: new Decimal(verification.amount),
          currency: verification.currency,
          source: "FLUTTERWAVE_VERIFY",
        });
      }
    }

    const updated = await this.prisma.transaction.findUnique({
      where: { reference },
      select: { status: true, amount: true, currency: true },
    });

    return updated;
  }

  async processWebhookDeposit(data: {
    provider?: PaymentProviderName;
    eventType?: string;
    reference: string;
    status: string;
    amount: number;
    currency: string;
    rawPayload?: Record<string, unknown>;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { reference: data.reference },
      });

      if (!transaction) {
        this.logger.info(
          { reference: data.reference },
          "Webhook: Transaction not found",
        );
        return { received: true, processed: false };
      }

      if (transaction.status !== "PENDING") {
        this.logger.info(
          { reference: data.reference },
          "Webhook: Already processed",
        );
        return { received: true, processed: false };
      }

      const metadata = transaction.metadata as Record<string, unknown>;
      const provider = data.provider
        ? this.normalizePaymentProvider(data.provider)
        : this.normalizePaymentProvider(
            (metadata?.provider as string) || "paystack",
          );
      const eventType = data.eventType || "payment.webhook";
      const rawPayload: Record<string, unknown> = data.rawPayload ?? {
        reference: data.reference,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
      };

      if (!this.isSuccessfulPaymentStatus(data.status)) {
        await this.createFundingProviderEvent(tx, {
          provider,
          eventType,
          providerReference: data.reference,
          status: "IGNORED",
          rawPayload,
          errorMessage: `Ignoring non-success payment status: ${data.status}`,
        });
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: "FAILED" },
        });
        return { received: true, processed: false };
      }

      const webhookAmount = new Decimal(data.amount);
      const currency = this.normalizeCurrency(data.currency);

      if (
        currency !== transaction.currency ||
        !this.amountsMatch(webhookAmount, new Decimal(transaction.amount))
      ) {
        this.logger.error(
          {
            reference: data.reference,
            webhookAmount: webhookAmount.toString(),
            storedAmount: transaction.amount.toString(),
            webhookCurrency: currency,
            storedCurrency: transaction.currency,
          },
          "Webhook: Deposit verification mismatch",
        );
        await this.createFundingProviderEvent(tx, {
          provider,
          eventType,
          providerReference: data.reference,
          status: "FAILED",
          rawPayload,
          errorMessage: "Provider amount or currency mismatch",
        });
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: "FAILED" },
        });
        return { received: true, processed: false };
      }

      const providerEvent = await this.createFundingProviderEvent(tx, {
        provider,
        eventType,
        providerReference: data.reference,
        status: "PROCESSING",
        rawPayload,
      });

      if (!providerEvent) {
        return { received: true, processed: false, duplicate: true };
      }

      const updated = await tx.transaction.updateMany({
        where: {
          reference: data.reference,
          status: "PENDING",
        },
        data: {
          status: "SUCCESS",
          metadata: this.mergeJsonMetadata(transaction.metadata, {
            providerEventId: providerEvent.id,
            providerStatus: data.status,
          }) as Prisma.InputJsonValue,
        },
      });

      if (updated.count === 0) {
        this.logger.info(
          { reference: data.reference },
          "Webhook: Already processed or not found",
        );
        return { received: true, processed: false };
      }

      await this.ledger.creditWallet(
        {
          userId: transaction.userId,
          currency: transaction.currency,
          amount: webhookAmount,
          transactionId: transaction.id,
          reference: transaction.reference,
          source: "PAYMENT_DEPOSIT",
          metadata: {
            provider: provider.toUpperCase(),
            providerStatus: data.status,
            providerEventId: providerEvent.id,
          },
        },
        tx,
      );

      await tx.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });

      this.logger.info(
        {
          reference: transaction.reference,
          amount: webhookAmount.toString(),
        },
        "Deposit processed successfully",
      );

      return { received: true, processed: true };
    });

    return result;
  }

  async withdraw(userId: string, dto: WithdrawDto) {
    await this.transactionPin.verifyRequired(userId, dto.transactionPin);

    const wallet = await this.walletsService.getWallet(userId, dto.currency);
    if (!wallet) {
      throw new NotFoundException(`${dto.currency} wallet not found`);
    }

    const amount = new Decimal(dto.amount);
    this.assertAmountWithinLimit(amount);

    if (wallet.balance.lt(amount)) {
      throw new BadRequestException(`Insufficient ${dto.currency} balance`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
        dailyWithdrawLimit: true,
        monthlyWithdrawLimit: true,
        dailyWithdrawn: true,
        monthlyWithdrawn: true,
        limitResetDate: true,
      },
    });

    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (user.isSuspended) {
      throw new ForbiddenException("Account is suspended");
    }

    if (user.kycStatus !== "VERIFIED") {
      throw new ForbiddenException("KYC verification is required");
    }

    if (!isKycTierAtLeast(user.kycTier, "TIER_2")) {
      throw new ForbiddenException(
        `KYC ${formatKycTier("TIER_2")} is required for withdrawals`,
      );
    }

    const destination = await this.resolveWithdrawalDestination(userId, dto);
    const provider = dto.provider || destination.provider || "monnify";
    if (provider !== "monnify") {
      throw new BadRequestException("Unsupported withdrawal provider");
    }
    if (dto.currency !== "NGN") {
      throw new BadRequestException(
        "Monnify withdrawals are currently supported for NGN only",
      );
    }

    const reference = `WD-${Date.now()}-${uuidv4().slice(0, 8)}`;
    let transferStatus = "pending";
    let finalStatus: TransactionStatus = "PENDING";
    let transferRequestSent = false;
    let withdrawalRecord:
      | {
          id: string;
          reference: string;
          transferAttemptId: string;
        }
      | null = null;

    withdrawalRecord = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const nextResetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      await tx.user.updateMany({
        where: {
          id: userId,
          OR: [{ limitResetDate: null }, { limitResetDate: { lt: now } }],
        },
        data: {
          dailyWithdrawn: new Decimal(0),
          monthlyWithdrawn: new Decimal(0),
          limitResetDate: nextResetDate,
        },
      });

      const limitUser = await tx.user.findUnique({
        where: { id: userId },
        select: {
          dailyWithdrawLimit: true,
          monthlyWithdrawLimit: true,
          dailyWithdrawn: true,
          monthlyWithdrawn: true,
          limitResetDate: true,
        },
      });

      if (!limitUser) {
        throw new BadRequestException("User not found");
      }

      const dailyWithdrawn = new Decimal(limitUser.dailyWithdrawn);
      const monthlyWithdrawn = new Decimal(limitUser.monthlyWithdrawn);
      const dailyWithdrawLimit = new Decimal(limitUser.dailyWithdrawLimit);
      const monthlyWithdrawLimit = new Decimal(limitUser.monthlyWithdrawLimit);

      if (dailyWithdrawn.plus(amount).greaterThan(dailyWithdrawLimit)) {
        throw new BadRequestException(
          `Daily withdrawal limit exceeded. Remaining: ${dailyWithdrawLimit
            .minus(dailyWithdrawn)
            .toFixed(2)}`,
        );
      }

      if (monthlyWithdrawn.plus(amount).greaterThan(monthlyWithdrawLimit)) {
        throw new BadRequestException(
          `Monthly withdrawal limit exceeded. Remaining: ${monthlyWithdrawLimit
            .minus(monthlyWithdrawn)
            .toFixed(2)}`,
        );
      }

      const limitsUpdated = await tx.user.updateMany({
        where: {
          id: userId,
          limitResetDate: limitUser.limitResetDate,
          dailyWithdrawn: { lte: dailyWithdrawLimit.minus(amount) },
          monthlyWithdrawn: { lte: monthlyWithdrawLimit.minus(amount) },
        },
        data: {
          dailyWithdrawn: { increment: amount },
          monthlyWithdrawn: { increment: amount },
        },
      });

      if (limitsUpdated.count !== 1) {
        throw new BadRequestException("Withdrawal limit exceeded");
      }

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: "WITHDRAW",
          amount,
          currency: dto.currency,
          status: "PENDING",
          reference,
          walletId: wallet.id,
          metadata: {
            provider,
            beneficiaryId: destination.beneficiaryId,
            bankCode: destination.bankCode,
            bankName: destination.bankName,
            accountName: destination.accountName,
            accountNumberMasked: destination.accountNumberMasked,
          },
        },
      });

      await this.ledger.debitWallet(
        {
          userId,
          currency: dto.currency,
          amount,
          transactionId: transaction.id,
          reference,
          source: "WITHDRAWAL",
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            accountNumberMasked: destination.accountNumberMasked,
          },
        },
        tx,
      );

      const transferAttempt = await tx.transferAttempt.create({
        data: {
          transactionId: transaction.id,
          provider: provider.toUpperCase() as "MONNIFY",
          providerReference: transaction.reference,
          providerStatus: "RESERVED",
          status: "PENDING",
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            bankCode: destination.bankCode,
            bankName: destination.bankName,
            accountName: destination.accountName,
            accountNumberMasked: destination.accountNumberMasked,
          },
        },
        select: { id: true },
      });

      return {
        id: transaction.id,
        reference: transaction.reference,
        transferAttemptId: transferAttempt.id,
      };
    });

    try {
      const sourceAccountNumber = this.getMonnifySourceAccountNumber();
      const transfer = await this.monnifyBanks.initiateTransfer({
        amount: toProviderDecimalString(amount),
        bankCode: destination.bankCode,
        accountNumber: destination.accountNumber,
        accountName: destination.accountName,
        sourceAccountNumber,
        currency: "NGN",
        reference: withdrawalRecord.reference,
      });

      transferRequestSent = true;
      transferStatus = transfer.status;
      finalStatus = this.mapTransferStatus(transferStatus);

      await this.prisma.transaction.update({
        where: { reference: withdrawalRecord.reference },
        data: { status: finalStatus },
      });

      await this.prisma.transferAttempt.update({
        where: { id: withdrawalRecord.transferAttemptId },
        data: {
          providerStatus: transferStatus,
          status: finalStatus,
          lastCheckedAt: new Date(),
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            bankCode: destination.bankCode,
            bankName: destination.bankName,
            accountName: destination.accountName,
            accountNumberMasked: destination.accountNumberMasked,
            providerTransactionReference:
              transfer.transactionReference || transfer.reference,
          },
        },
      });

      if (["FAILED", "REVERSED"].includes(finalStatus)) {
        await this.reverseWithdrawal(
          userId,
          dto.currency,
          amount,
          withdrawalRecord,
          destination,
        );

        this.logger.error(
          { reference: withdrawalRecord.reference, transferStatus },
          "Transfer failed, balance reversed",
        );
        throw new BadRequestException(
          "Transfer failed. Balance has been reversed.",
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException && transferRequestSent) {
        throw error;
      }

      if (!withdrawalRecord) {
        throw error;
      }

      if (!transferRequestSent) {
        const reconciledTransfer = await this.refreshWithdrawalTransferStatus(
          withdrawalRecord.reference,
        );

        if (reconciledTransfer) {
          const reconciledStatus = this.mapTransferStatus(
            reconciledTransfer.status,
          );

          await this.prisma.transaction.update({
            where: { reference: withdrawalRecord.reference },
            data: { status: reconciledStatus },
          });

          await this.prisma.transferAttempt.update({
            where: { id: withdrawalRecord.transferAttemptId },
            data: {
              providerStatus: reconciledTransfer.status,
              status: reconciledStatus,
              lastCheckedAt: new Date(),
              metadata: {
                beneficiaryId: destination.beneficiaryId,
                bankCode: destination.bankCode,
                bankName: destination.bankName,
                accountName: destination.accountName,
                accountNumberMasked: destination.accountNumberMasked,
                providerTransactionReference:
                  reconciledTransfer.reference || withdrawalRecord.reference,
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : "Unknown provider error",
              },
            },
          });

          if (["FAILED", "REVERSED"].includes(reconciledStatus)) {
            await this.reverseWithdrawal(
              userId,
              dto.currency,
              amount,
              withdrawalRecord,
              destination,
            );

            this.logger.error(
              {
                reference: withdrawalRecord.reference,
                transferStatus: reconciledTransfer.status,
              },
              "Transfer failed after provider reconciliation, balance reversed",
            );
            throw new BadRequestException(
              "Transfer failed. Balance has been reversed.",
            );
          }

          this.logger.info(
            {
              reference: withdrawalRecord.reference,
              transferStatus: reconciledTransfer.status,
            },
            "Transfer reconciliation completed",
          );

          return {
            reference: withdrawalRecord.reference,
            status: reconciledStatus,
            message:
              reconciledStatus === "SUCCESS"
                ? "Withdrawal completed successfully"
                : "Withdrawal submitted and pending provider confirmation",
          };
        }

        await this.prisma.transferAttempt.update({
          where: { id: withdrawalRecord.transferAttemptId },
          data: {
            providerStatus: "UNKNOWN",
            status: "PENDING",
            lastCheckedAt: new Date(),
            metadata: {
              beneficiaryId: destination.beneficiaryId,
              bankCode: destination.bankCode,
              bankName: destination.bankName,
              accountName: destination.accountName,
              accountNumberMasked: destination.accountNumberMasked,
              providerTransactionReference: withdrawalRecord.reference,
              errorMessage:
                error instanceof Error
                  ? error.message
                  : "Unknown provider error",
            },
          },
        });

        this.logger.error(
          {
            reference: withdrawalRecord.reference,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Transfer submission could not be confirmed, withdrawal left pending",
        );

        return {
          reference: withdrawalRecord.reference,
          status: "PENDING",
          message:
            "Withdrawal submitted and pending provider confirmation. Funds remain reserved until verification completes.",
        };
      }

      await this.prisma.transaction.update({
        where: { reference: withdrawalRecord.reference },
        data: { status: "PENDING" },
      });

      await this.prisma.transferAttempt.update({
        where: { id: withdrawalRecord.transferAttemptId },
        data: {
          providerStatus: "UNKNOWN",
          status: "PENDING",
          lastCheckedAt: new Date(),
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            bankCode: destination.bankCode,
            bankName: destination.bankName,
            accountName: destination.accountName,
            accountNumberMasked: destination.accountNumberMasked,
            providerTransactionReference: withdrawalRecord.reference,
            errorMessage:
              error instanceof Error ? error.message : "Unknown provider error",
          },
        },
      });

      this.logger.warn(
        {
          reference: withdrawalRecord.reference,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Transfer provider result unknown, withdrawal left pending",
      );

      return {
        reference: withdrawalRecord.reference,
        status: "PENDING",
        message:
          "Withdrawal submitted and pending provider confirmation. Funds remain reserved until verification completes.",
      };
    }

    this.logger.info(
      {
        userId,
        reference: withdrawalRecord.reference,
        amount: amount.toString(),
        currency: dto.currency,
      },
      "Withdrawal processed",
    );

    return {
      reference: withdrawalRecord.reference,
      status: finalStatus,
      message:
        finalStatus === "SUCCESS"
          ? "Withdrawal completed successfully"
          : "Withdrawal submitted and pending provider confirmation",
    };
  }

  async getWithdrawal(userId: string, reference: string) {
    const transaction = await this.loadWithdrawal(userId, reference);

    if (!transaction) {
      throw new NotFoundException("Withdrawal not found");
    }

    const refreshed = await this.reconcileWithdrawalTransferStatus(
      userId,
      transaction,
    );

    return {
      ...refreshed,
      metadata: this.sanitizeWithdrawalMetadata(refreshed.metadata),
      transferAttempts: refreshed.transferAttempts.map((attempt) => ({
        ...attempt,
        metadata: this.sanitizeWithdrawalMetadata(attempt.metadata),
      })),
    };
  }

  async authorizeWithdrawal(
    userId: string,
    reference: string,
    authorizationCode: string,
  ) {
    const withdrawal = await this.loadWithdrawal(userId, reference);

    if (!withdrawal) {
      throw new NotFoundException("Withdrawal not found");
    }

    const reconciled = await this.reconcileWithdrawalTransferStatus(
      userId,
      withdrawal,
    );

    const latestAttempt = reconciled.transferAttempts[0];
    if (!latestAttempt) {
      throw new BadRequestException("Withdrawal has not been submitted");
    }

    if (
      (latestAttempt.providerStatus || "")
        .toString()
        .toUpperCase() !== "PENDING_AUTHORIZATION"
    ) {
      throw new BadRequestException("Transaction not awaiting authorization");
    }

    const providerReference = this.getWithdrawalProviderReference(
      reconciled.reference,
      latestAttempt.metadata,
    );

    const authorization = await this.monnifyBanks.authorizeTransfer({
      reference: providerReference,
      authorizationCode,
    });
    const finalStatus = this.mapTransferStatus(authorization.status);

    const updatedTransaction = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.transaction.updateMany({
        where: {
          id: reconciled.id,
          status: "PENDING",
        },
        data: { status: finalStatus },
      });

      if (transition.count === 0) {
        return false;
      }

      await tx.transferAttempt.update({
        where: { id: latestAttempt.id },
        data: {
          providerStatus: authorization.status,
          status: finalStatus,
          lastCheckedAt: new Date(),
          metadata: this.mergeJsonMetadata(latestAttempt.metadata, {
            providerTransactionReference:
              authorization.transactionReference || providerReference,
            providerAuthorizationStatus:
              authorization.responseMessage || authorization.status,
          }) as Prisma.InputJsonValue,
        },
      });

      return true;
    });

    if (updatedTransaction && ["FAILED", "REVERSED"].includes(finalStatus)) {
      const withdrawalMetadata =
        reconciled.metadata &&
        typeof reconciled.metadata === "object" &&
        !Array.isArray(reconciled.metadata)
          ? (reconciled.metadata as Record<string, unknown>)
          : {};
      const attemptMetadata =
        latestAttempt.metadata &&
        typeof latestAttempt.metadata === "object" &&
        !Array.isArray(latestAttempt.metadata)
          ? (latestAttempt.metadata as Record<string, unknown>)
          : {};

      await this.reverseWithdrawal(
        userId,
        reconciled.currency as WithdrawDto["currency"],
        new Decimal(reconciled.amount),
        {
          id: reconciled.id,
          reference: reconciled.reference,
        },
        {
          beneficiaryId:
            (attemptMetadata.beneficiaryId as string | undefined) ||
            (withdrawalMetadata.beneficiaryId as string | undefined),
          accountNumberMasked:
            (attemptMetadata.accountNumberMasked as string | undefined) ||
            (withdrawalMetadata.accountNumberMasked as string | undefined) ||
            maskAccountNumber("0000000000"),
        },
      );
    }

    return {
      reference: reconciled.reference,
      status: finalStatus,
      message:
        finalStatus === "SUCCESS"
          ? "Withdrawal authorized successfully"
          : "Withdrawal authorization submitted",
    };
  }

  async resendWithdrawalOtp(userId: string, reference: string) {
    const withdrawal = await this.loadWithdrawal(userId, reference);

    if (!withdrawal) {
      throw new NotFoundException("Withdrawal not found");
    }

    const reconciled = await this.reconcileWithdrawalTransferStatus(
      userId,
      withdrawal,
    );

    const latestAttempt = reconciled.transferAttempts[0];
    if (!latestAttempt) {
      throw new BadRequestException("Withdrawal has not been submitted");
    }

    if (
      (latestAttempt.providerStatus || "")
        .toString()
        .toUpperCase() !== "PENDING_AUTHORIZATION"
    ) {
      throw new BadRequestException("Transaction not awaiting authorization");
    }

    const providerReference = this.getWithdrawalProviderReference(
      reconciled.reference,
      latestAttempt.metadata,
    );

    const response = await this.monnifyBanks.resendTransferOtp(
      providerReference,
    );

    await this.prisma.transferAttempt.update({
      where: { id: latestAttempt.id },
      data: {
        lastCheckedAt: new Date(),
        metadata: this.mergeJsonMetadata(latestAttempt.metadata, {
          otpResentAt: new Date().toISOString(),
          providerTransactionReference:
            response.reference || providerReference,
        }) as Prisma.InputJsonValue,
      },
    });

    return {
      reference: response.reference || reconciled.reference,
      message:
        response.responseMessage || "Withdrawal OTP resent successfully",
      emailRecipients: response.emailRecipients || [],
    };
  }

  async processTransferWebhook(input: {
    provider: "paystack" | "flutterwave" | "monnify";
    eventType: string;
    providerReference: string;
    providerStatus: string;
    rawPayload: Record<string, unknown>;
  }) {
    const provider = input.provider.toUpperCase() as
      | "PAYSTACK"
      | "FLUTTERWAVE"
      | "MONNIFY";
    const payload = this.sanitizeProviderPayload(input.rawPayload);

    let providerEvent: { id: string; status: string };

    try {
      providerEvent = await this.prisma.providerEvent.create({
        data: {
          provider,
          eventType: input.eventType,
          providerReference: input.providerReference,
          status: "PROCESSING",
          payload: payload as Prisma.InputJsonValue,
        },
        select: { id: true, status: true },
      });
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      return { received: true, processed: false, duplicate: true };
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { reference: input.providerReference },
      include: {
        transferAttempts: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!transaction || transaction.type !== "WITHDRAW") {
      await this.prisma.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: "IGNORED",
          errorMessage: "Withdrawal transaction not found",
          processedAt: new Date(),
        },
      });
      return { received: true, processed: false };
    }

    const finalStatus = this.mapTransferStatus(input.providerStatus);

    await this.prisma.$transaction(async (tx) => {
      const transitionStatus =
        finalStatus === "REVERSED"
          ? { in: ["PENDING", "SUCCESS"] as TransactionStatus[] }
          : "PENDING";
      const updatedTransaction = await tx.transaction.updateMany({
        where: {
          id: transaction.id,
          status: transitionStatus,
        },
        data: { status: finalStatus },
      });

      const latestAttempt = transaction.transferAttempts[0];
      if (latestAttempt) {
        await tx.transferAttempt.update({
          where: { id: latestAttempt.id },
          data: {
            providerStatus: input.providerStatus,
            status: finalStatus,
            lastCheckedAt: new Date(),
            metadata: this.mergeJsonMetadata(latestAttempt.metadata, {
              providerEventId: providerEvent.id,
            }) as Prisma.InputJsonValue,
          },
        });
      }

      if (
        updatedTransaction.count === 1 &&
        ["FAILED", "REVERSED"].includes(finalStatus)
      ) {
        const existingReversal = await tx.ledgerEntry.findFirst({
          where: {
            transactionId: transaction.id,
            source: "WITHDRAWAL_REVERSAL",
          },
        });

        if (!existingReversal) {
          await this.ledger.creditWallet(
            {
              userId: transaction.userId,
              currency: transaction.currency,
              amount: new Decimal(transaction.amount),
              transactionId: transaction.id,
              reference: `${transaction.reference}-REVERSAL`,
              source: "WITHDRAWAL_REVERSAL",
              metadata: {
                provider,
                providerStatus: input.providerStatus,
                providerEventId: providerEvent.id,
              },
            },
            tx,
          );
          await tx.user.updateMany({
            where: {
              id: transaction.userId,
              dailyWithdrawn: { gte: new Decimal(transaction.amount) },
            },
            data: {
              dailyWithdrawn: { decrement: new Decimal(transaction.amount) },
            },
          });
          await tx.user.updateMany({
            where: {
              id: transaction.userId,
              monthlyWithdrawn: { gte: new Decimal(transaction.amount) },
            },
            data: {
              monthlyWithdrawn: { decrement: new Decimal(transaction.amount) },
            },
          });
        }
      }

      await tx.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });
    });

    return { received: true, processed: true };
  }

  private async resolveWithdrawalDestination(
    userId: string,
    dto: WithdrawDto,
  ): Promise<WithdrawalDestination> {
    if (dto.beneficiaryId) {
      const beneficiary = await this.prisma.bankAccount.findFirst({
        where: {
          id: dto.beneficiaryId,
          userId,
          isDeleted: false,
          currency: dto.currency,
        },
      });

      if (!beneficiary) {
        throw new NotFoundException("Beneficiary not found");
      }

      const decryptedAccountNumber = decryptSensitiveValue(
        beneficiary.accountNumberEncrypted,
        this.getBankAccountEncryptionKey(),
      );
      const resolved = await this.monnifyBanks.resolveBankAccount(
        decryptedAccountNumber,
        beneficiary.bankCode,
      );
      this.assertAccountNameMatches(
        beneficiary.accountName,
        resolved.accountName,
      );

      return {
        beneficiaryId: beneficiary.id,
        provider: "monnify",
        bankCode: resolved.bankCode || beneficiary.bankCode,
        bankName: resolved.bankName || beneficiary.bankName,
        accountName: resolved.accountName,
        accountNumber: decryptedAccountNumber,
        accountNumberMasked: beneficiary.accountNumberMasked,
      };
    }

    if (!dto.bankCode || !dto.accountNumber) {
      throw new BadRequestException(
        "Provide beneficiaryId or bankCode and accountNumber",
      );
    }

    const resolved = await this.monnifyBanks.resolveBankAccount(
      dto.accountNumber,
      dto.bankCode,
    );

    if (dto.accountName) {
      this.assertAccountNameMatches(dto.accountName, resolved.accountName);
    }

    return {
      provider: "monnify",
      bankCode: resolved.bankCode || dto.bankCode,
      bankName: resolved.bankName,
      accountName: resolved.accountName,
      accountNumber: dto.accountNumber,
      accountNumberMasked: maskAccountNumber(dto.accountNumber),
    };
  }

  private async reverseWithdrawal(
    userId: string,
    currency: WithdrawDto["currency"],
    amount: Decimal,
    transaction: { id: string; reference: string },
    destination: Pick<WithdrawalDestination, "beneficiaryId" | "accountNumberMasked">,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const existingReversal = await tx.ledgerEntry.findFirst({
        where: {
          transactionId: transaction.id,
          source: "WITHDRAWAL_REVERSAL",
        },
      });

      if (existingReversal) {
        return;
      }

      await this.ledger.creditWallet(
        {
          userId,
          currency,
          amount,
          transactionId: transaction.id,
          reference: `${transaction.reference}-REVERSAL`,
          source: "WITHDRAWAL_REVERSAL",
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            accountNumberMasked: destination.accountNumberMasked,
          },
        },
        tx,
      );

      await tx.user.updateMany({
        where: { id: userId, dailyWithdrawn: { gte: amount } },
        data: { dailyWithdrawn: { decrement: amount } },
      });
      await tx.user.updateMany({
        where: { id: userId, monthlyWithdrawn: { gte: amount } },
        data: { monthlyWithdrawn: { decrement: amount } },
      });
    });
  }

  private async refreshWithdrawalTransferStatus(reference: string) {
    try {
      return await this.monnifyBanks.getTransferStatus(reference);
    } catch (error) {
      this.logger.warn(
        {
          reference,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Could not refresh withdrawal transfer status",
      );
      return null;
    }
  }

  private async reconcileWithdrawalTransferStatus(
    userId: string,
    withdrawal: WithdrawalRecord,
  ): Promise<WithdrawalRecord> {
    const latestAttempt = withdrawal.transferAttempts[0];
    if (!latestAttempt) {
      return withdrawal;
    }

    const providerStatus = (
      latestAttempt.providerStatus || withdrawal.status || ""
    )
      .toString()
      .toUpperCase();

    if (["SUCCESS", "FAILED", "REVERSED"].includes(providerStatus)) {
      return withdrawal;
    }

    const providerReference = this.getWithdrawalProviderReference(
      withdrawal.reference,
      latestAttempt.metadata,
    );
    const refreshed = await this.refreshWithdrawalTransferStatus(
      providerReference,
    );

    if (!refreshed) {
      return withdrawal;
    }

    const reconciledStatus = this.mapTransferStatus(refreshed.status);
    const refreshedAt = new Date();

    if (reconciledStatus === "PENDING") {
      return {
        ...withdrawal,
        transferAttempts: withdrawal.transferAttempts.map((attempt, index) =>
          index === 0
            ? {
                ...attempt,
                providerStatus: refreshed.status,
                lastCheckedAt: refreshedAt,
                metadata: this.mergeJsonMetadata(attempt.metadata, {
                  providerTransactionReference:
                    refreshed.reference || providerReference,
                }) as Prisma.InputJsonValue,
              }
            : attempt,
        ),
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.transaction.updateMany({
        where: {
          id: withdrawal.id,
          status: "PENDING",
        },
        data: { status: reconciledStatus },
      });

      await tx.transferAttempt.update({
        where: { id: latestAttempt.id },
        data: {
          providerStatus: refreshed.status,
          status: reconciledStatus,
          lastCheckedAt: refreshedAt,
          metadata: this.mergeJsonMetadata(latestAttempt.metadata, {
            providerTransactionReference:
              refreshed.reference || providerReference,
            providerRefreshStatus:
              refreshed.responseMessage || refreshed.status,
          }) as Prisma.InputJsonValue,
        },
      });

      return transition.count === 1;
    });

    if (updated && ["FAILED", "REVERSED"].includes(reconciledStatus)) {
      const withdrawalMetadata =
        withdrawal.metadata &&
        typeof withdrawal.metadata === "object" &&
        !Array.isArray(withdrawal.metadata)
          ? (withdrawal.metadata as Record<string, unknown>)
          : {};
      const attemptMetadata =
        latestAttempt.metadata &&
        typeof latestAttempt.metadata === "object" &&
        !Array.isArray(latestAttempt.metadata)
          ? (latestAttempt.metadata as Record<string, unknown>)
          : {};

      await this.reverseWithdrawal(
        userId,
        withdrawal.currency as WithdrawDto["currency"],
        new Decimal(withdrawal.amount),
        {
          id: withdrawal.id,
          reference: withdrawal.reference,
        },
        {
          beneficiaryId:
            (attemptMetadata.beneficiaryId as string | undefined) ||
            (withdrawalMetadata.beneficiaryId as string | undefined),
          accountNumberMasked:
            (attemptMetadata.accountNumberMasked as string | undefined) ||
            (withdrawalMetadata.accountNumberMasked as string | undefined) ||
            maskAccountNumber("0000000000"),
        },
      );
    }

    return {
      ...withdrawal,
      status: reconciledStatus,
      transferAttempts: withdrawal.transferAttempts.map((attempt, index) =>
        index === 0
          ? {
              ...attempt,
              providerStatus: refreshed.status,
              status: reconciledStatus,
              lastCheckedAt: refreshedAt,
              metadata: this.mergeJsonMetadata(attempt.metadata, {
                providerTransactionReference:
                  refreshed.reference || providerReference,
                providerRefreshStatus:
                  refreshed.responseMessage || refreshed.status,
              }) as Prisma.InputJsonValue,
            }
          : attempt,
      ),
    };
  }

  private async loadWithdrawal(userId: string, reference: string) {
    return this.prisma.transaction.findFirst({
      where: {
        userId,
        reference,
        type: "WITHDRAW",
      },
      select: {
        id: true,
        reference: true,
        amount: true,
        currency: true,
        status: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        transferAttempts: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            provider: true,
            providerReference: true,
            providerStatus: true,
            status: true,
            attemptNo: true,
            lastCheckedAt: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }) as Promise<WithdrawalRecord | null>;
  }

  private getWithdrawalProviderReference(
    reference: string,
    metadata: unknown,
  ) {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const providerTransactionReference = (
        metadata as Record<string, unknown>
      ).providerTransactionReference;

      if (
        typeof providerTransactionReference === "string" &&
        providerTransactionReference.trim().length > 0
      ) {
        return providerTransactionReference;
      }
    }

    return reference;
  }

  private mapTransferStatus(status: string) {
    const normalized = status.toLowerCase();

    if (
      ["success", "successful", "completed", "complete"].includes(normalized)
    ) {
      return "SUCCESS";
    }

    if (["reversed"].includes(normalized)) {
      return "REVERSED";
    }

    if (
      [
        "failed",
        "abandoned",
        "blocked",
        "rejected",
        "expired",
        "otp_email_dispatch_failed",
      ].includes(normalized)
    ) {
      return "FAILED";
    }

    if (
      [
        "pending",
        "awaiting_processing",
        "in_progress",
        "processing",
        "pending_authorization",
        "transaction_processing_in_progress",
      ].includes(normalized)
    ) {
      return "PENDING";
    }

    return "PENDING";
  }

  private assertAccountNameMatches(expected: string, actual: string) {
    const normalize = (value: string) =>
      value.trim().replace(/\s+/g, " ").toUpperCase();

    if (normalize(expected) !== normalize(actual)) {
      throw new BadRequestException(
        "Account name does not match the selected bank account",
      );
    }
  }

  private getBankAccountEncryptionKey() {
    const key =
      this.configService.get<string>("BANK_ACCOUNT_ENCRYPTION_KEY") ||
      this.configService.get<string>("PII_ENCRYPTION_KEY");

    if (!key) {
      throw new BadRequestException(
        "Sensitive data encryption key is not configured",
      );
    }

    return key;
  }

  private sanitizeWithdrawalMetadata(metadata: unknown) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return {};
    }

    const safeMetadata = { ...(metadata as Record<string, unknown>) };
    delete safeMetadata.accountNumber;
    delete safeMetadata.account_number;
    delete safeMetadata.accountNumberEncrypted;
    delete safeMetadata.receiver_bank_account_number;
    delete safeMetadata.bvn;
    delete safeMetadata.nin;
    delete safeMetadata.signature;
    delete safeMetadata.token;

    return safeMetadata;
  }

  private mergeJsonMetadata(
    existing: unknown,
    updates: Record<string, unknown>,
  ) {
    return {
      ...(existing && typeof existing === "object" && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {}),
      ...updates,
    };
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }

  private sanitizeProviderPayload(payload: Record<string, unknown>) {
    const sanitized = this.sanitizeWithdrawalMetadata(payload);
    const data = sanitized.data;

    if (data && typeof data === "object" && !Array.isArray(data)) {
      sanitized.data = this.sanitizeWithdrawalMetadata(data);
    }

    return sanitized;
  }

  async resolveBank(dto: ResolveBankDto) {
    return this.monnifyBanks.resolveBankAccount(
      dto.accountNumber,
      dto.bankCode,
    );
  }

  async listBanks() {
    return this.monnifyBanks.listBanks();
  }

  verifyPaystackSignature(rawBody: string, signature: string): boolean {
    const secret = this.configService.getOrThrow<string>("PAYSTACK_SECRET_KEY");
    const hash = createHmac("sha512", secret).update(rawBody).digest("hex");
    if (hash.length !== signature.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }

  verifyFlutterwaveSignature(rawBody: string, signature: string): boolean {
    const secret = this.configService.getOrThrow<string>(
      "FLUTTERWAVE_SECRET_KEY",
    );
    const hash = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (hash.length !== signature.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }

  verifyFlutterwaveSecretHash(verifHash: string): boolean {
    const secretHash = this.configService.getOrThrow<string>(
      "FLUTTERWAVE_SECRET_HASH",
    );
    if (secretHash.length !== verifHash.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(secretHash), Buffer.from(verifHash));
  }

  private async processVerifiedDeposit(
    transaction: Transaction,
    providerData: {
      provider: PaymentProviderName;
      reference: string;
      status: string;
      amount: Decimal;
      currency: string;
      source: string;
    },
  ) {
    const currency = this.normalizeCurrency(providerData.currency);

    if (
      providerData.reference !== transaction.reference ||
      !this.isSuccessfulPaymentStatus(providerData.status) ||
      currency !== transaction.currency ||
      !this.amountsMatch(providerData.amount, new Decimal(transaction.amount))
    ) {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: "FAILED" },
      });
      this.logger.error(
        {
          reference: transaction.reference,
          providerReference: providerData.reference,
          providerStatus: providerData.status,
          providerAmount: providerData.amount.toString(),
          transactionAmount: transaction.amount.toString(),
          providerCurrency: currency,
          transactionCurrency: transaction.currency,
        },
        "Payment verification mismatch",
      );
      throw new BadRequestException("Payment verification mismatch");
    }

    await this.prisma.$transaction(async (tx) => {
      const providerEvent = await this.createFundingProviderEvent(tx, {
        provider: providerData.provider,
        eventType: "payment.verify",
        providerReference: transaction.reference,
        status: "PROCESSING",
        rawPayload: {
          reference: providerData.reference,
          status: providerData.status,
          amount: providerData.amount.toString(),
          currency,
        },
      });

      if (!providerEvent) {
        return;
      }

      const updated = await tx.transaction.updateMany({
        where: {
          id: transaction.id,
          status: "PENDING",
        },
        data: {
          status: "SUCCESS",
          metadata: this.mergeJsonMetadata(transaction.metadata, {
            providerEventId: providerEvent.id,
            providerStatus: providerData.status,
          }) as Prisma.InputJsonValue,
        },
      });

      if (updated.count === 0) {
        this.logger.info(
          { reference: transaction.reference },
          "Deposit already processed",
        );
        await tx.providerEvent.update({
          where: { id: providerEvent.id },
          data: {
            status: "IGNORED",
            errorMessage: "Funding transaction is no longer pending",
            processedAt: new Date(),
          },
        });
        return;
      }

      await this.ledger.creditWallet(
        {
          userId: transaction.userId,
          currency: transaction.currency,
          amount: providerData.amount,
          transactionId: transaction.id,
          reference: transaction.reference,
          source: providerData.source,
          metadata: {
            provider: providerData.provider.toUpperCase(),
            providerStatus: providerData.status,
            providerEventId: providerEvent.id,
          },
        },
        tx,
      );

      await tx.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });
    });

    this.logger.info(
      {
        reference: transaction.reference,
        amount: transaction.amount,
      },
      "Deposit processed successfully",
    );
  }

  private isSuccessfulPaymentStatus(status: string) {
    return ["success", "successful", "completed", "complete"].includes(
      status.toLowerCase(),
    );
  }

  private async createFundingProviderEvent(
    tx: Pick<Prisma.TransactionClient, "providerEvent">,
    input: {
      provider: PaymentProviderName;
      eventType: string;
      providerReference: string;
      status: "PROCESSING" | "FAILED" | "IGNORED";
      rawPayload: Record<string, unknown>;
      errorMessage?: string;
    },
  ) {
    try {
      return await tx.providerEvent.create({
        data: {
          provider: input.provider.toUpperCase() as "PAYSTACK" | "FLUTTERWAVE",
          eventType: input.eventType,
          providerReference: input.providerReference,
          status: input.status,
          payload: this.sanitizeProviderPayload(
            input.rawPayload,
          ) as Prisma.InputJsonValue,
          errorMessage: input.errorMessage,
          processedAt: input.status === "PROCESSING" ? undefined : new Date(),
        },
        select: { id: true, status: true },
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        return null;
      }

      throw error;
    }
  }

  private normalizeCurrency(currency: string) {
    return currency.toUpperCase() as "NGN" | "GHS";
  }

  private normalizePaymentProvider(provider: string): PaymentProviderName {
    const normalized = provider.toLowerCase();
    if (normalized !== "paystack" && normalized !== "flutterwave") {
      throw new BadRequestException("Unsupported payment provider");
    }

    return normalized;
  }

  private amountsMatch(left: Decimal, right: Decimal) {
    return left.minus(right).abs().lessThanOrEqualTo(new Decimal(0.01));
  }

  private assertAmountWithinLimit(amount: Decimal) {
    if (
      !amount.isFinite() ||
      amount.lessThanOrEqualTo(0) ||
      amount.greaterThan(10_000_000)
    ) {
      throw new BadRequestException("Amount must be between 0.01 and 10000000");
    }
  }

  private buildPaymentCallbackUrl() {
    const webUrl =
      this.configService.get<string>("WEB_URL") || "http://localhost:3001";
    const base = new URL(webUrl);

    if (
      this.configService.get<string>("NODE_ENV") === "production" &&
      base.protocol !== "https:"
    ) {
      throw new BadRequestException("Invalid payment callback configuration");
    }

    return new URL("/payment/callback", base).toString();
  }

  private getDefaultProvider(currency: string): string {
    return currency === "NGN" ? "paystack" : "flutterwave";
  }

  private getMonnifySourceAccountNumber() {
    const sourceAccountNumber = (
      this.configService.get<string>("MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER") ||
      ""
    ).trim();

    if (!sourceAccountNumber) {
      throw new BadRequestException(
        "Monnify source account number is not configured",
      );
    }

    return sourceAccountNumber;
  }
}
