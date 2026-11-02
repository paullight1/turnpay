import { PaystackVirtualAccountProvider } from '../banking/providers/paystack-virtual-account.provider';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { WithdrawDto, ResolveBankDto } from './dto/payment.dto';
import {
  financialRequestIdentity,
  assertFinancialRequestMatch,
} from '../common/utils/financial-request';
import { PinoLogger } from 'nestjs-pino';
import { Prisma, TransactionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../wallets/ledger.service';
import { MonnifyVirtualAccountProvider } from '../banking/providers/monnify-virtual-account.provider';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '../common/utils/encryption';
import { maskAccountNumber } from '../common/utils/masking';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { formatKycTier, isKycTierAtLeast } from '../common/utils/kyc-tier';
import { toProviderDecimalString } from './utils/provider-amount';
import {
  isReconciliationSettlementHoldError,
  SettlementHoldService,
} from '../common/services/settlement-hold.service';

type WithdrawalProvider = 'monnify' | 'paystack';

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
    provider?: 'MONNIFY' | 'PAYSTACK';
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
  private readonly settlementHold: SettlementHoldService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly monnifyBanks: MonnifyVirtualAccountProvider,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly ledger: LedgerService,
    private readonly transactionPin: TransactionPinService,
    @Optional() settlementHold?: SettlementHoldService,
    @Optional() private readonly paystackBanks?: PaystackVirtualAccountProvider,
  ) {
    // Keep direct construction fail-closed. Production DI supplies the
    // shared service; fixtures that omit it still exercise the persisted
    // reconciliation check instead of silently bypassing the hold.
    this.settlementHold = settlementHold ?? new SettlementHoldService(prisma);
  }

  private async replayWithdrawal(
    userId: string,
    reference: string,
    fingerprint: string,
  ) {
    const existing = await this.prisma.transaction.findUnique({
      where: { reference },
      select: {
        userId: true,
        type: true,
        reference: true,
        status: true,
        metadata: true,
      },
    });
    if (!existing) return null;
    if (existing.userId !== userId || existing.type !== 'WITHDRAW') {
      throw new BadRequestException('Withdrawal request does not match');
    }
    assertFinancialRequestMatch(existing.metadata, fingerprint);
    return {
      reference: existing.reference,
      status: existing.status,
      message:
        'Your original withdrawal is available. Check its status before starting another.',
    };
  }

  async withdraw(userId: string, dto: WithdrawDto, idempotencyKey: string) {
    const identity = financialRequestIdentity(
      'WITHDRAW',
      userId,
      idempotencyKey,
      {
        ...dto,
        amount: new Decimal(dto.amount).toFixed(2),
      },
    );
    const replay = await this.replayWithdrawal(
      userId,
      identity.reference,
      identity.fingerprint,
    );
    if (replay) return replay;
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
      throw new BadRequestException('User not found');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('Account is suspended');
    }

    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException('KYC verification is required');
    }

    if (!isKycTierAtLeast(user.kycTier, 'TIER_1')) {
      throw new ForbiddenException(
        `KYC ${formatKycTier('TIER_1')} is required for withdrawals`,
      );
    }

    const destination = await this.resolveWithdrawalDestination(userId, dto);
    const provider = this.primaryProvider;
    if (dto.provider && dto.provider !== provider)
      throw new BadRequestException('Use the active payment provider');
    if (provider !== 'monnify' && provider !== 'paystack') {
      throw new BadRequestException('Unsupported withdrawal provider');
    }
    if (dto.currency !== 'NGN') {
      throw new BadRequestException(
        'Withdrawals are currently supported for NGN only',
      );
    }

    if (
      provider === 'paystack' &&
      (!this.paystackBanks?.configured ||
        this.configService.get<boolean>('WITHDRAWALS_ENABLED', true) === false)
    )
      throw new BadRequestException('Paystack withdrawals are unavailable');
    const encryptedDestination =
      provider === 'paystack'
        ? encryptSensitiveValue(
            destination.accountNumber,
            this.getBankAccountEncryptionKey(),
          )
        : undefined;
    const reference = identity.reference;
    let transferStatus = 'pending';
    let finalStatus: TransactionStatus = 'PENDING';
    let transferRequestSent = false;
    let withdrawalRecord: {
      id: string;
      reference: string;
      transferAttemptId: string;
    } | null = null;

    try {
      withdrawalRecord = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const startOfUtcDay = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );
        const startOfNextUtcMonth = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        );

        // Daily reset: dailyWithdrawn resets at the start of each UTC day.
        await tx.user.updateMany({
          where: {
            id: userId,
            OR: [
              { dailyLimitResetDate: null },
              { dailyLimitResetDate: { lt: startOfUtcDay } },
            ],
          },
          data: {
            dailyWithdrawn: new Decimal(0),
            dailyLimitResetDate: startOfUtcDay,
          },
        });

        // Monthly reset: monthlyWithdrawn resets at the start of each UTC month.
        await tx.user.updateMany({
          where: {
            id: userId,
            OR: [{ limitResetDate: null }, { limitResetDate: { lt: now } }],
          },
          data: {
            monthlyWithdrawn: new Decimal(0),
            limitResetDate: startOfNextUtcMonth,
          },
        });

        const limitUser = await tx.user.findUnique({
          where: { id: userId },
          select: {
            dailyWithdrawLimit: true,
            monthlyWithdrawLimit: true,
            dailyWithdrawn: true,
            monthlyWithdrawn: true,
            dailyLimitResetDate: true,
            limitResetDate: true,
          },
        });

        if (!limitUser) {
          throw new BadRequestException('User not found');
        }

        const dailyWithdrawn = new Decimal(limitUser.dailyWithdrawn);
        const monthlyWithdrawn = new Decimal(limitUser.monthlyWithdrawn);
        const dailyWithdrawLimit = new Decimal(limitUser.dailyWithdrawLimit);
        const monthlyWithdrawLimit = new Decimal(
          limitUser.monthlyWithdrawLimit,
        );

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
            dailyLimitResetDate: limitUser.dailyLimitResetDate,
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
          throw new BadRequestException('Withdrawal limit exceeded');
        }

        const transaction = await tx.transaction.create({
          data: {
            userId,
            type: 'WITHDRAW',
            amount,
            currency: dto.currency,
            status: 'PENDING',
            reference,
            walletId: wallet.id,
            metadata: {
              requestFingerprint: identity.fingerprint,
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
            source: 'WITHDRAWAL',
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
            provider: provider.toUpperCase() as 'MONNIFY' | 'PAYSTACK',
            providerReference: transaction.reference,
            providerStatus: 'RESERVED',
            status: 'PENDING',
            metadata: {
              ...(encryptedDestination
                ? { accountNumberEncrypted: encryptedDestination }
                : {}),
              beneficiaryId: destination.beneficiaryId,
              bankCode: destination.bankCode,
              bankName: destination.bankName,
              accountName: destination.accountName,
              accountNumberMasked: destination.accountNumberMasked,
            },
          },
          select: { id: true },
        });

        if (provider === 'paystack')
          await tx.auditLog.create({
            data: {
              action: 'PAYSTACK_WITHDRAWAL_RESERVED',
              targetType: 'Transaction',
              targetId: transaction.id,
              reference: transaction.reference,
              metadata: {
                userId,
                amount: amount.toFixed(2),
                currency: dto.currency,
                accountNumberMasked: destination.accountNumberMasked,
              },
            },
          });

        return {
          id: transaction.id,
          reference: transaction.reference,
          transferAttemptId: transferAttempt.id,
        };
      });
    } catch (error) {
      // A concurrent identical reservation may have won. Its unique reference
      // and debit committed together; never dispatch a second provider request.
      const replay = await this.replayWithdrawal(
        userId,
        reference,
        identity.fingerprint,
      );
      if (replay) return replay;
      throw error;
    }

    try {
      await this.assertSettlementAllowed(
        withdrawalRecord.reference,
        'WITHDRAWAL',
      );
      const sourceAccountNumber =
        provider === 'monnify'
          ? this.getMonnifySourceAccountNumber()
          : undefined;
      const transfer = await this.providerAdapter(provider).initiateTransfer({
        amount: toProviderDecimalString(amount),
        bankCode: destination.bankCode,
        accountNumber: destination.accountNumber,
        accountName: destination.accountName,
        sourceAccountNumber,
        currency: 'NGN',
        reference: withdrawalRecord.reference,
      });

      transferRequestSent = true;
      transferStatus = transfer.status;
      if (provider === 'paystack') {
        await this.processTransferWebhook({
          provider,
          eventType: 'transfer.confirmation',
          providerReference: withdrawalRecord.reference,
          providerStatus: transfer.status,
          rawPayload: {},
        });
        const current = await this.prisma.transaction.findUnique({
          where: { reference: withdrawalRecord.reference },
          select: { status: true },
        });
        return {
          reference: withdrawalRecord.reference,
          status: current?.status ?? 'PENDING',
          message:
            current?.status === 'SUCCESS'
              ? 'Withdrawal completed successfully'
              : 'Withdrawal is awaiting provider confirmation. Refresh its status shortly.',
        };
      }
      finalStatus = this.mapTransferStatus(transferStatus);

      // Guarded: only transition a still-PENDING withdrawal. A disbursement
      // webhook may have already marked it terminal (e.g. REVERSED + refund);
      // this sync path must not overwrite that.
      await this.prisma.transaction.updateMany({
        where: { reference: withdrawalRecord.reference, status: 'PENDING' },
        data: { status: finalStatus },
      });

      await this.prisma.transferAttempt.update({
        where: { id: withdrawalRecord.transferAttemptId },
        data: {
          providerStatus: transferStatus,
          status: finalStatus,
          lastCheckedAt: new Date(),
          metadata: {
            ...(encryptedDestination
              ? { accountNumberEncrypted: encryptedDestination }
              : {}),
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

      if (['FAILED', 'REVERSED'].includes(finalStatus)) {
        await this.reverseWithdrawal(
          userId,
          dto.currency,
          amount,
          withdrawalRecord,
          destination,
        );

        this.logger.error(
          { reference: withdrawalRecord.reference, transferStatus },
          'Transfer failed, balance reversed',
        );
        throw new BadRequestException(
          'Transfer failed. Balance has been reversed.',
        );
      }
    } catch (error) {
      if (
        provider === 'monnify' &&
        error instanceof BadRequestException &&
        transferRequestSent
      ) {
        throw error;
      }

      if (!withdrawalRecord) {
        throw error;
      }

      // The hold is checked again immediately before provider dispatch. If a
      // new BLOCKED run appeared after reservation, release the local debit
      // and mark the attempt terminal instead of treating the hold as an
      // ambiguous provider timeout with funds still reserved.
      if (!transferRequestSent && isReconciliationSettlementHoldError(error)) {
        if (provider === 'paystack') {
          await this.releaseRejectedPaystackWithdrawal(
            userId,
            dto.currency,
            amount,
            withdrawalRecord,
          );
          throw error;
        }
        await this.prisma.transaction.updateMany({
          where: { reference: withdrawalRecord.reference, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
        await this.prisma.transferAttempt.update({
          where: { id: withdrawalRecord.transferAttemptId },
          data: {
            providerStatus: 'RECONCILIATION_HOLD',
            status: 'FAILED',
            lastCheckedAt: new Date(),
          },
        });
        await this.reverseWithdrawal(
          userId,
          dto.currency,
          amount,
          withdrawalRecord,
          destination,
        );
        this.logger.warn(
          { reference: withdrawalRecord.reference },
          'Withdrawal reservation released because reconciliation blocked settlement',
        );
        throw error;
      }

      if (provider === 'paystack') {
        if (!transferRequestSent && error instanceof BadRequestException) {
          const released = await this.releaseRejectedPaystackWithdrawal(
            userId,
            dto.currency,
            amount,
            withdrawalRecord,
          );
          const current = released
            ? null
            : await this.prisma.transaction.findUnique({
                where: { reference: withdrawalRecord.reference },
                select: { status: true },
              });
          return {
            reference: withdrawalRecord.reference,
            status: released ? 'FAILED' : (current?.status ?? 'PENDING'),
            message:
              'Paystack rejected the transfer. Your reserved funds have been returned.',
          };
        }
        try {
          await this.processPaystackTransfer({
            provider,
            eventType: 'transfer.reconcile',
            providerReference: withdrawalRecord.reference,
            providerStatus: 'pending',
            rawPayload: {},
          });
        } catch {
          this.logger.warn(
            { reference: withdrawalRecord.reference },
            'Paystack withdrawal requires provider confirmation',
          );
        }
        const current = await this.prisma.transaction.findUnique({
          where: { reference: withdrawalRecord.reference },
          select: { status: true },
        });
        return {
          reference: withdrawalRecord.reference,
          status: current?.status ?? 'PENDING',
          message:
            'Check this withdrawal status before sending again. Funds remain reserved until provider confirmation.',
        };
      }

      if (!transferRequestSent) {
        const reconciledTransfer = await this.refreshWithdrawalTransferStatus(
          withdrawalRecord.reference,
          provider,
        );

        if (reconciledTransfer) {
          const reconciledStatus = this.mapTransferStatus(
            reconciledTransfer.status,
          );

          await this.prisma.transaction.updateMany({
            where: { reference: withdrawalRecord.reference, status: 'PENDING' },
            data: { status: reconciledStatus },
          });

          await this.prisma.transferAttempt.update({
            where: { id: withdrawalRecord.transferAttemptId },
            data: {
              providerStatus: reconciledTransfer.status,
              status: reconciledStatus,
              lastCheckedAt: new Date(),
              metadata: {
                ...(encryptedDestination
                  ? { accountNumberEncrypted: encryptedDestination }
                  : {}),
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
                    : 'Unknown provider error',
              },
            },
          });

          if (['FAILED', 'REVERSED'].includes(reconciledStatus)) {
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
              'Transfer failed after provider reconciliation, balance reversed',
            );
            throw new BadRequestException(
              'Transfer failed. Balance has been reversed.',
            );
          }

          this.logger.info(
            {
              reference: withdrawalRecord.reference,
              transferStatus: reconciledTransfer.status,
            },
            'Transfer reconciliation completed',
          );

          return {
            reference: withdrawalRecord.reference,
            status: reconciledStatus,
            message:
              reconciledStatus === 'SUCCESS'
                ? 'Withdrawal completed successfully'
                : 'Withdrawal submitted and pending provider confirmation',
          };
        }

        await this.prisma.transferAttempt.update({
          where: { id: withdrawalRecord.transferAttemptId },
          data: {
            providerStatus: 'UNKNOWN',
            status: 'PENDING',
            lastCheckedAt: new Date(),
            metadata: {
              ...(encryptedDestination
                ? { accountNumberEncrypted: encryptedDestination }
                : {}),
              beneficiaryId: destination.beneficiaryId,
              bankCode: destination.bankCode,
              bankName: destination.bankName,
              accountName: destination.accountName,
              accountNumberMasked: destination.accountNumberMasked,
              providerTransactionReference: withdrawalRecord.reference,
              errorMessage:
                error instanceof Error
                  ? error.message
                  : 'Unknown provider error',
            },
          },
        });

        this.logger.error(
          {
            reference: withdrawalRecord.reference,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Transfer submission could not be confirmed, withdrawal left pending',
        );

        return {
          reference: withdrawalRecord.reference,
          status: 'PENDING',
          message:
            'Withdrawal submitted and pending provider confirmation. Funds remain reserved until verification completes.',
        };
      }

      // Guarded: never force a withdrawal back to PENDING once a webhook has
      // moved it to a terminal state (SUCCESS/REVERSED with refund).
      await this.prisma.transaction.updateMany({
        where: { reference: withdrawalRecord.reference, status: 'PENDING' },
        data: { status: 'PENDING' },
      });

      await this.prisma.transferAttempt.update({
        where: { id: withdrawalRecord.transferAttemptId },
        data: {
          providerStatus: 'UNKNOWN',
          status: 'PENDING',
          lastCheckedAt: new Date(),
          metadata: {
            ...(encryptedDestination
              ? { accountNumberEncrypted: encryptedDestination }
              : {}),
            beneficiaryId: destination.beneficiaryId,
            bankCode: destination.bankCode,
            bankName: destination.bankName,
            accountName: destination.accountName,
            accountNumberMasked: destination.accountNumberMasked,
            providerTransactionReference: withdrawalRecord.reference,
            errorMessage:
              error instanceof Error ? error.message : 'Unknown provider error',
          },
        },
      });

      this.logger.warn(
        {
          reference: withdrawalRecord.reference,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Transfer provider result unknown, withdrawal left pending',
      );

      return {
        reference: withdrawalRecord.reference,
        status: 'PENDING',
        message:
          'Withdrawal submitted and pending provider confirmation. Funds remain reserved until verification completes.',
      };
    }

    this.logger.info(
      {
        userId,
        reference: withdrawalRecord.reference,
        amount: amount.toString(),
        currency: dto.currency,
      },
      'Withdrawal processed',
    );

    return {
      reference: withdrawalRecord.reference,
      status: finalStatus,
      message:
        finalStatus === 'SUCCESS'
          ? 'Withdrawal completed successfully'
          : 'Withdrawal submitted and pending provider confirmation',
    };
  }

  async getWithdrawal(userId: string, reference: string) {
    const transaction = await this.loadWithdrawal(userId, reference);

    if (!transaction) {
      throw new NotFoundException('Withdrawal not found');
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
    if (withdrawal?.transferAttempts[0]?.provider === 'PAYSTACK')
      throw new ForbiddenException(
        'This transfer needs merchant approval. Contact support.',
      );

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }

    const reconciled = await this.reconcileWithdrawalTransferStatus(
      userId,
      withdrawal,
    );

    const latestAttempt = reconciled.transferAttempts[0];
    if (!latestAttempt) {
      throw new BadRequestException('Withdrawal has not been submitted');
    }

    if (
      (latestAttempt.providerStatus || '').toString().toUpperCase() !==
      'PENDING_AUTHORIZATION'
    ) {
      throw new BadRequestException('Transaction not awaiting authorization');
    }

    const providerReference = this.getWithdrawalProviderReference(
      reconciled.reference,
      latestAttempt.metadata,
    );

    await this.assertSettlementAllowed(reconciled.reference, 'WITHDRAWAL');
    const authorization = await this.monnifyBanks.authorizeTransfer({
      reference: providerReference,
      authorizationCode,
    });
    const finalStatus = this.mapTransferStatus(authorization.status);

    const updatedTransaction = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.transaction.updateMany({
        where: {
          id: reconciled.id,
          status: 'PENDING',
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

    if (updatedTransaction && ['FAILED', 'REVERSED'].includes(finalStatus)) {
      const withdrawalMetadata =
        reconciled.metadata &&
        typeof reconciled.metadata === 'object' &&
        !Array.isArray(reconciled.metadata)
          ? (reconciled.metadata as Record<string, unknown>)
          : {};
      const attemptMetadata =
        latestAttempt.metadata &&
        typeof latestAttempt.metadata === 'object' &&
        !Array.isArray(latestAttempt.metadata)
          ? (latestAttempt.metadata as Record<string, unknown>)
          : {};

      await this.reverseWithdrawal(
        userId,
        reconciled.currency as WithdrawDto['currency'],
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
            maskAccountNumber('0000000000'),
        },
      );
    }

    return {
      reference: reconciled.reference,
      status: finalStatus,
      message:
        finalStatus === 'SUCCESS'
          ? 'Withdrawal authorized successfully'
          : 'Withdrawal authorization submitted',
    };
  }

  async resendWithdrawalOtp(userId: string, reference: string) {
    const withdrawal = await this.loadWithdrawal(userId, reference);
    if (withdrawal?.transferAttempts[0]?.provider === 'PAYSTACK')
      throw new ForbiddenException(
        'This transfer needs merchant approval. Contact support.',
      );

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }

    const reconciled = await this.reconcileWithdrawalTransferStatus(
      userId,
      withdrawal,
    );

    const latestAttempt = reconciled.transferAttempts[0];
    if (!latestAttempt) {
      throw new BadRequestException('Withdrawal has not been submitted');
    }

    if (
      (latestAttempt.providerStatus || '').toString().toUpperCase() !==
      'PENDING_AUTHORIZATION'
    ) {
      throw new BadRequestException('Transaction not awaiting authorization');
    }

    const providerReference = this.getWithdrawalProviderReference(
      reconciled.reference,
      latestAttempt.metadata,
    );

    const response =
      await this.monnifyBanks.resendTransferOtp(providerReference);

    await this.prisma.transferAttempt.update({
      where: { id: latestAttempt.id },
      data: {
        lastCheckedAt: new Date(),
        metadata: this.mergeJsonMetadata(latestAttempt.metadata, {
          otpResentAt: new Date().toISOString(),
          providerTransactionReference: response.reference || providerReference,
        }) as Prisma.InputJsonValue,
      },
    });

    return {
      reference: response.reference || reconciled.reference,
      message: response.responseMessage || 'Withdrawal OTP resent successfully',
      emailRecipients: response.emailRecipients || [],
    };
  }

  async processTransferWebhook(input: {
    provider: WithdrawalProvider;
    eventType: string;
    providerReference: string;
    providerStatus: string;
    rawPayload: Record<string, unknown>;
  }) {
    if (input.provider === 'paystack')
      return this.processPaystackTransfer(input);
    const provider = 'MONNIFY' as const;
    const payload = this.sanitizeProviderPayload(input.rawPayload);

    let providerEvent: { id: string; status: string };

    try {
      providerEvent = await this.prisma.providerEvent.create({
        data: {
          provider,
          eventType: input.eventType,
          providerReference: input.providerReference,
          status: 'PROCESSING',
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
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!transaction || transaction.type !== 'WITHDRAW') {
      await this.prisma.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: 'IGNORED',
          errorMessage: 'Withdrawal transaction not found',
          processedAt: new Date(),
        },
      });
      return { received: true, processed: false };
    }

    const finalStatus = this.mapTransferStatus(input.providerStatus);

    await this.prisma.$transaction(async (tx) => {
      const transitionStatus =
        finalStatus === 'REVERSED'
          ? { in: ['PENDING', 'SUCCESS'] as TransactionStatus[] }
          : 'PENDING';
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
        ['FAILED', 'REVERSED'].includes(finalStatus)
      ) {
        const existingReversal = await tx.ledgerEntry.findFirst({
          where: {
            transactionId: transaction.id,
            source: 'WITHDRAWAL_REVERSAL',
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
              source: 'WITHDRAWAL_REVERSAL',
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
          status: 'PROCESSED',
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
        throw new NotFoundException('Beneficiary not found');
      }

      const decryptedAccountNumber = decryptSensitiveValue(
        beneficiary.accountNumberEncrypted,
        this.getBankAccountEncryptionKey(),
      );
      let bankCode = beneficiary.bankCode;
      if (
        this.primaryProvider === 'paystack' &&
        beneficiary.provider !== 'PAYSTACK'
      ) {
        const normalizedName = (name: string) =>
          name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const banks = await this.providerAdapter('paystack').listBanks();
        const matches = banks.filter(
          (bank) =>
            normalizedName(bank.name) === normalizedName(beneficiary.bankName),
        );
        if (matches.length !== 1)
          throw new BadRequestException(
            'Re-add this saved beneficiary using the current bank list before withdrawing',
          );
        bankCode = matches[0].code;
      }
      const resolved = await this.providerAdapter(
        this.primaryProvider,
      ).resolveBankAccount(decryptedAccountNumber, bankCode);
      this.assertAccountNameMatches(
        beneficiary.accountName,
        resolved.accountName,
      );

      return {
        beneficiaryId: beneficiary.id,
        provider: this.primaryProvider,
        bankCode: resolved.bankCode || bankCode,
        bankName: resolved.bankName || beneficiary.bankName,
        accountName: resolved.accountName,
        accountNumber: decryptedAccountNumber,
        accountNumberMasked: beneficiary.accountNumberMasked,
      };
    }

    if (!dto.bankCode || !dto.accountNumber) {
      throw new BadRequestException(
        'Provide beneficiaryId or bankCode and accountNumber',
      );
    }

    const resolved = await this.providerAdapter(
      this.primaryProvider,
    ).resolveBankAccount(dto.accountNumber, dto.bankCode);

    if (dto.accountName) {
      this.assertAccountNameMatches(dto.accountName, resolved.accountName);
    }

    return {
      provider: this.primaryProvider,
      bankCode: resolved.bankCode || dto.bankCode,
      bankName: resolved.bankName,
      accountName: resolved.accountName,
      accountNumber: dto.accountNumber,
      accountNumberMasked: maskAccountNumber(dto.accountNumber),
    };
  }

  private async reverseWithdrawal(
    userId: string,
    currency: WithdrawDto['currency'],
    amount: Decimal,
    transaction: { id: string; reference: string },
    destination: Pick<
      WithdrawalDestination,
      'beneficiaryId' | 'accountNumberMasked'
    >,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const existingReversal = await tx.ledgerEntry.findFirst({
        where: {
          transactionId: transaction.id,
          source: 'WITHDRAWAL_REVERSAL',
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
          source: 'WITHDRAWAL_REVERSAL',
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

  private async refreshWithdrawalTransferStatus(
    reference: string,
    provider: WithdrawalProvider = 'monnify',
  ) {
    try {
      return await this.providerAdapter(provider).getTransferStatus(reference);
    } catch (error) {
      this.logger.warn(
        {
          reference,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Could not refresh withdrawal transfer status',
      );
      return null;
    }
  }

  /**
   * Sweeps withdrawals that are still PENDING past a grace window and drives
   * them to a terminal state by re-querying the provider. This is the backstop
   * for the case where the disbursement webhook is never delivered and the user
   * never reads the withdrawal — otherwise the debited funds stay reserved
   * indefinitely. Reconciliation is idempotent (guarded transitions + existing
   * reversal check), so re-processing an already-resolved withdrawal is safe.
   */
  async reconcilePendingWithdrawals(limit = 25) {
    const graceMinutes = this.configService.get<number>(
      'WITHDRAWAL_RECONCILE_GRACE_MINUTES',
      10,
    );
    const cutoff = new Date(Date.now() - graceMinutes * 60_000);

    const pending = (await this.prisma.transaction.findMany({
      where: {
        type: 'WITHDRAW',
        currency: 'NGN',
        status: 'PENDING',
        updatedAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        reference: true,
        amount: true,
        currency: true,
        status: true,
        metadata: true,
        transferAttempts: {
          orderBy: { createdAt: 'desc' },
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
    })) as Array<WithdrawalRecord & { userId: string }>;

    let resolved = 0;

    for (const withdrawal of pending) {
      try {
        const result = await this.reconcileWithdrawalTransferStatus(
          withdrawal.userId,
          withdrawal,
        );

        if (result.status !== 'PENDING') {
          resolved += 1;
        }
      } catch (error) {
        this.logger.warn(
          {
            reference: withdrawal.reference,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Failed to reconcile pending withdrawal',
        );
      }
    }

    return { checked: pending.length, resolved };
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
      latestAttempt.providerStatus ||
      withdrawal.status ||
      ''
    )
      .toString()
      .toUpperCase();

    if (['SUCCESS', 'FAILED', 'REVERSED'].includes(providerStatus)) {
      return withdrawal;
    }

    if (String(latestAttempt.provider) === 'KORA') return withdrawal;
    if (latestAttempt.provider === 'PAYSTACK') {
      await this.processPaystackTransfer({
        provider: 'paystack',
        eventType: 'transfer.reconcile',
        providerReference: withdrawal.reference,
        providerStatus: 'pending',
        rawPayload: {},
      });
      return (
        (await this.loadWithdrawal(userId, withdrawal.reference)) ?? withdrawal
      );
    }
    const providerReference = this.getWithdrawalProviderReference(
      withdrawal.reference,
      latestAttempt.metadata,
    );
    const refreshed =
      await this.refreshWithdrawalTransferStatus(providerReference);

    if (!refreshed) {
      return withdrawal;
    }

    const reconciledStatus = this.mapTransferStatus(refreshed.status);
    const refreshedAt = new Date();

    if (reconciledStatus === 'PENDING') {
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
                }),
              }
            : attempt,
        ),
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.transaction.updateMany({
        where: {
          id: withdrawal.id,
          status: 'PENDING',
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

    if (updated && ['FAILED', 'REVERSED'].includes(reconciledStatus)) {
      const withdrawalMetadata =
        withdrawal.metadata &&
        typeof withdrawal.metadata === 'object' &&
        !Array.isArray(withdrawal.metadata)
          ? (withdrawal.metadata as Record<string, unknown>)
          : {};
      const attemptMetadata =
        latestAttempt.metadata &&
        typeof latestAttempt.metadata === 'object' &&
        !Array.isArray(latestAttempt.metadata)
          ? (latestAttempt.metadata as Record<string, unknown>)
          : {};

      await this.reverseWithdrawal(
        userId,
        withdrawal.currency as WithdrawDto['currency'],
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
            maskAccountNumber('0000000000'),
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
              }),
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
        type: 'WITHDRAW',
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
          orderBy: { createdAt: 'desc' },
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

  private getWithdrawalProviderReference(reference: string, metadata: unknown) {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const providerTransactionReference = (metadata as Record<string, unknown>)
        .providerTransactionReference;

      if (
        typeof providerTransactionReference === 'string' &&
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
      ['success', 'successful', 'completed', 'complete'].includes(normalized)
    ) {
      return 'SUCCESS';
    }

    if (['reversed'].includes(normalized)) {
      return 'REVERSED';
    }

    if (
      [
        'failed',
        'abandoned',
        'blocked',
        'rejected',
        'expired',
        'otp_email_dispatch_failed',
      ].includes(normalized)
    ) {
      return 'FAILED';
    }

    if (
      [
        'pending',
        'awaiting_processing',
        'in_progress',
        'processing',
        'pending_authorization',
        'transaction_processing_in_progress',
      ].includes(normalized)
    ) {
      return 'PENDING';
    }

    return 'PENDING';
  }

  private assertAccountNameMatches(expected: string, actual: string) {
    const normalize = (value: string) =>
      value.trim().replace(/\s+/g, ' ').toUpperCase();

    if (normalize(expected) !== normalize(actual)) {
      throw new BadRequestException(
        'Account name does not match the selected bank account',
      );
    }
  }

  private getBankAccountEncryptionKey() {
    const key =
      this.configService.get<string>('BANK_ACCOUNT_ENCRYPTION_KEY') ||
      this.configService.get<string>('PII_ENCRYPTION_KEY');

    if (!key) {
      throw new BadRequestException(
        'Sensitive data encryption key is not configured',
      );
    }

    return key;
  }

  private sanitizeWithdrawalMetadata(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    const safeMetadata = { ...(metadata as Record<string, unknown>) };
    delete safeMetadata.requestFingerprint;
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
      ...(existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {}),
      ...updates,
    };
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private sanitizeProviderPayload(payload: Record<string, unknown>) {
    const sanitized = this.sanitizeWithdrawalMetadata(payload);
    const data = sanitized.data;

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      sanitized.data = this.sanitizeWithdrawalMetadata(data);
    }

    return sanitized;
  }

  async resolveBank(dto: ResolveBankDto) {
    return this.providerAdapter(this.primaryProvider).resolveBankAccount(
      dto.accountNumber,
      dto.bankCode,
    );
  }

  async listBanks() {
    return this.providerAdapter(this.primaryProvider).listBanks();
  }

  private assertAmountWithinLimit(amount: Decimal) {
    if (
      !amount.isFinite() ||
      amount.lessThanOrEqualTo(0) ||
      amount.greaterThan(10_000_000)
    ) {
      throw new BadRequestException('Amount must be between 0.01 and 10000000');
    }
  }

  private async assertSettlementAllowed(
    reference: string,
    operation: 'WITHDRAWAL',
  ) {
    await this.settlementHold.assertSettlementAllowed({
      operation,
      scope: 'ADMIN_BANKING',
      currency: 'NGN',
      provider: this.primaryProvider.toUpperCase(),
      reference,
    });
  }

  private get primaryProvider(): WithdrawalProvider {
    return this.configService.get<string>(
      'BANKING_PROVIDER_PRIMARY',
      'paystack',
    ) === 'monnify'
      ? 'monnify'
      : 'paystack';
  }

  private providerAdapter(provider: WithdrawalProvider) {
    if (provider === 'monnify') return this.monnifyBanks;
    if (!this.paystackBanks)
      throw new BadRequestException('Paystack is not configured');
    return this.paystackBanks;
  }

  private async releaseRejectedPaystackWithdrawal(
    userId: string,
    currency: 'NGN' | 'GHS',
    amount: Decimal,
    record: { id: string; reference: string; transferAttemptId: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.transaction.updateMany({
        where: { id: record.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      if (changed.count !== 1) return false;
      await tx.transferAttempt.update({
        where: { id: record.transferAttemptId },
        data: {
          status: 'FAILED',
          providerStatus: 'REJECTED_BEFORE_ACCEPTANCE',
          lastCheckedAt: new Date(),
        },
      });
      await this.ledger.creditWallet(
        {
          userId,
          currency,
          amount,
          transactionId: record.id,
          reference: `${record.reference}-REVERSAL`,
          source: 'WITHDRAWAL_REVERSAL',
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
      await tx.auditLog.create({
        data: {
          action: 'PAYSTACK_WITHDRAWAL_REJECTED',
          targetType: 'Transaction',
          targetId: record.id,
          reference: record.reference,
          metadata: {
            userId,
            amount: amount.toFixed(2),
            currency,
            reason:
              'Submission was rejected before acceptance or blocked by reconciliation',
          },
        },
      });
      return true;
    });
  }

  private async processPaystackTransfer(input: {
    provider: WithdrawalProvider;
    eventType: string;
    providerReference: string;
    providerStatus: string;
    rawPayload: Record<string, unknown>;
  }) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { reference: input.providerReference },
      include: {
        transferAttempts: {
          where: { provider: 'PAYSTACK' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (
      !transaction ||
      transaction.type !== 'WITHDRAW' ||
      !transaction.transferAttempts[0]
    )
      return { ignored: true };
    const attempt = transaction.transferAttempts[0];
    const confirmed = await this.providerAdapter('paystack').getTransferStatus(
      transaction.reference,
    );
    const raw = confirmed.raw;
    const recipient = raw.recipient as Record<string, unknown> | undefined;
    const details = recipient?.details as Record<string, unknown> | undefined;
    const metadata = attempt.metadata as Record<string, unknown> | null;
    const verifiedMinor = new Decimal(
      typeof raw.amount === 'number' || typeof raw.amount === 'string'
        ? raw.amount
        : 'NaN',
    );
    const expectedDomain = this.configService
      .get<string>('PAYSTACK_SECRET_KEY')
      ?.startsWith('sk_live_')
      ? 'live'
      : 'test';
    const validEnvironment = raw.domain === expectedDomain;
    const expectedAccount =
      typeof metadata?.accountNumberEncrypted === 'string'
        ? decryptSensitiveValue(
            metadata.accountNumberEncrypted,
            this.getBankAccountEncryptionKey(),
          )
        : '';
    if (
      !validEnvironment ||
      raw.reference !== transaction.reference ||
      raw.currency !== transaction.currency ||
      !verifiedMinor.isInteger() ||
      !verifiedMinor.eq(transaction.amount.mul(100)) ||
      !details ||
      typeof details.account_number !== 'string' ||
      details.account_number !== expectedAccount ||
      details.bank_code !== metadata?.bankCode
    )
      throw new BadRequestException(
        'Transfer confirmation does not match the withdrawal',
      );
    const status = this.mapTransferStatus(confirmed.status);
    return this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.transaction.updateMany({
        where: {
          id: transaction.id,
          status:
            status === 'REVERSED' ? { in: ['PENDING', 'SUCCESS'] } : 'PENDING',
        },
        data: { status },
      });
      if (transitioned.count !== 1) return { received: true, duplicate: true };
      await tx.transferAttempt.update({
        where: { id: attempt.id },
        data: {
          status,
          providerStatus: confirmed.status,
          lastCheckedAt: new Date(),
          metadata: {
            ...metadata,
            providerRecipientCode:
              typeof recipient?.recipient_code === 'string'
                ? recipient.recipient_code
                : null,
          },
        },
      });
      if (status === 'FAILED' || status === 'REVERSED') {
        const reversed = await tx.ledgerEntry.findFirst({
          where: {
            transactionId: transaction.id,
            source: 'WITHDRAWAL_REVERSAL',
          },
        });
        if (!reversed) {
          await this.ledger.creditWallet(
            {
              userId: transaction.userId,
              currency: transaction.currency,
              amount: transaction.amount,
              transactionId: transaction.id,
              reference: `${transaction.reference}-REVERSAL`,
              source: 'WITHDRAWAL_REVERSAL',
            },
            tx,
          );
          await tx.user.updateMany({
            where: {
              id: transaction.userId,
              dailyWithdrawn: { gte: transaction.amount },
            },
            data: { dailyWithdrawn: { decrement: transaction.amount } },
          });
          await tx.user.updateMany({
            where: {
              id: transaction.userId,
              monthlyWithdrawn: { gte: transaction.amount },
            },
            data: { monthlyWithdrawn: { decrement: transaction.amount } },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          action: 'PAYSTACK_WITHDRAWAL_CONFIRMED',
          targetType: 'Transaction',
          targetId: transaction.id,
          reference: transaction.reference,
          metadata: {
            provider: 'PAYSTACK',
            status,
            eventType: input.eventType,
            amount: transaction.amount.toString(),
            currency: transaction.currency,
          },
        },
      });
      return { received: true, status };
    });
  }

  private getMonnifySourceAccountNumber() {
    const sourceAccountNumber = (
      this.configService.get<string>(
        'MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER',
      ) || ''
    ).trim();

    if (!sourceAccountNumber) {
      throw new BadRequestException(
        'Monnify source account number is not configured',
      );
    }

    return sourceAccountNumber;
  }
}
