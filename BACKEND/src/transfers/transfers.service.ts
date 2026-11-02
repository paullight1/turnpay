import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { KYCTier, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import {
  InternalTransferDto,
  RecipientPreviewDto,
} from './dto/internal-transfer.dto';

type RecipientIdentifiers = Pick<
  InternalTransferDto,
  'recipientId' | 'recipientEmail' | 'recipientPhone'
>;

const RECIPIENT_PREVIEW_MIN_DELAY_MS = 120;
const RECIPIENT_PREVIEW_JITTER_MS = 30;

export function recipientPreviewDelayMs(
  startedAtMs: number,
  identifier: string,
  nowMs = Date.now(),
) {
  const jitterSeed = createHash('sha256').update(identifier).digest()[0];
  const targetMs =
    RECIPIENT_PREVIEW_MIN_DELAY_MS +
    (jitterSeed % (RECIPIENT_PREVIEW_JITTER_MS + 1));
  return Math.max(0, targetMs - Math.max(0, nowMs - startedAtMs));
}
import { maskEmail, maskPhone } from '../common/utils/masking';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { formatKycTier, isKycTierAtLeast } from '../common/utils/kyc-tier';
import { InternalTransferRequestContext } from './internal-transfer-request-context';
import {
  InternalTransferIdempotencyService,
  InternalTransferResponse,
} from './internal-transfer-idempotency.service';
import {
  ActiveInternalTransferLimitPolicy,
  InternalTransferLimitService,
} from './internal-transfer-limit.service';
import {
  TransferPostCommitFault,
  TransferPostCommitHook,
} from './transfer-post-commit.hook';

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly logger: PinoLogger,
    private readonly transactionPin: TransactionPinService,
    private readonly idempotency: InternalTransferIdempotencyService,
    private readonly limitPolicy: InternalTransferLimitService,
    private readonly postCommitHook: TransferPostCommitHook,
  ) {}

  async sendInternalTransfer(
    userId: string,
    dto: InternalTransferDto,
    context: InternalTransferRequestContext,
  ): Promise<InternalTransferResponse> {
    let amount: Decimal | undefined;
    let recipient: {
      id: string;
      email?: string | null;
      phone?: string | null;
      kycStatus: string;
      kycTier?: KYCTier | null;
      isSuspended: boolean;
    } | null = null;
    const keyHash = this.idempotency.hashKey(context.idempotencyKey);
    const requestHash = this.idempotency.fingerprint(dto);

    try {
      const replay = await this.idempotency.findReplay(
        userId,
        keyHash,
        requestHash,
      );
      if (replay) {
        return replay;
      }

      await this.transactionPin.verifyRequired(userId, dto.transactionPin);
      this.assertSingleRecipientIdentifier(dto);

      amount = new Decimal(dto.amount);
      if (
        !amount.isFinite() ||
        amount.lessThanOrEqualTo(0) ||
        amount.decimalPlaces() > 2
      ) {
        throw new BadRequestException(
          'Amount must be positive with at most 2 decimal places',
        );
      }

      const sender = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone: true,
          kycStatus: true,
          kycTier: true,
          isSuspended: true,
        },
      });

      if (!sender) {
        throw new NotFoundException('User not found');
      }

      this.assertUserCanTransfer(sender, 'sender');

      recipient = await this.findRecipient(dto);
      if (!recipient) {
        throw new NotFoundException('Recipient not found');
      }

      if (recipient.id === sender.id) {
        throw new BadRequestException('Cannot transfer to yourself');
      }

      this.assertRecipientCanReceive(recipient);
      const transferAmount = amount;
      const transferRecipient = recipient;

      const transferReference = `IT-${Date.now()}-${uuidv4().slice(0, 8)}`;
      const senderReference = `${transferReference}-OUT`;
      const recipientReference = `${transferReference}-IN`;

      const result = await this.prisma.$transaction(
        async (tx) => {
          const attempt = await this.idempotency.createProcessing(tx, {
            userId: sender.id,
            keyHash,
            requestHash,
            context,
          });

          const policy = await this.limitPolicy.getActivePolicy(
            tx,
            dto.currency,
            sender.kycTier,
          );
          this.limitPolicy.assertAmountWithinPolicy(transferAmount, policy);

          await this.reserveTransferLimitUsage(
            tx,
            sender.id,
            dto.currency,
            transferAmount,
            policy,
          );

          const senderTx = await tx.transaction.create({
            data: {
              userId: sender.id,
              type: 'INTERNAL_TRANSFER',
              amount: transferAmount,
              currency: dto.currency,
              status: 'SUCCESS',
              reference: senderReference,
              metadata: {
                direction: 'OUT',
                transferReference,
                counterpartyUserId: transferRecipient.id,
                counterpartyMaskedIdentifier:
                  this.maskRecipient(transferRecipient),
                note: dto.note,
              },
            },
          });

          const recipientTx = await tx.transaction.create({
            data: {
              userId: transferRecipient.id,
              type: 'INTERNAL_TRANSFER',
              amount: transferAmount,
              currency: dto.currency,
              status: 'SUCCESS',
              reference: recipientReference,
              metadata: {
                direction: 'IN',
                transferReference,
                counterpartyUserId: sender.id,
                counterpartyMaskedIdentifier: this.maskRecipient(sender),
                note: dto.note,
              },
            },
          });

          const senderLedger = await this.ledger.debitWallet(
            {
              userId: sender.id,
              currency: dto.currency,
              amount: transferAmount,
              transactionId: senderTx.id,
              reference: transferReference,
              source: 'INTERNAL_TRANSFER_OUT',
              metadata: {
                recipientUserId: transferRecipient.id,
              },
            },
            tx,
          );

          const recipientLedger = await this.ledger.creditWallet(
            {
              userId: transferRecipient.id,
              currency: dto.currency,
              amount: transferAmount,
              transactionId: recipientTx.id,
              reference: transferReference,
              source: 'INTERNAL_TRANSFER_IN',
              metadata: {
                senderUserId: sender.id,
              },
            },
            tx,
          );

          await tx.transaction.update({
            where: { id: senderTx.id },
            data: { walletId: senderLedger.walletId },
          });
          await tx.transaction.update({
            where: { id: recipientTx.id },
            data: { walletId: recipientLedger.walletId },
          });

          const response: InternalTransferResponse = {
            reference: transferReference,
            status: 'SUCCESS',
            amount: transferAmount.toString(),
            currency: dto.currency,
            senderTransactionReference: senderReference,
            senderBalanceAfter: senderLedger.balanceAfter.toString(),
            recipient: {
              maskedIdentifier: this.maskRecipient(transferRecipient),
              avatarInitials: this.getAvatarInitials(transferRecipient),
            },
            createdAt: new Date().toISOString(),
          };

          await this.idempotency.complete(tx, attempt.id, {
            recipientUserId: transferRecipient.id,
            transferReference,
            senderTransactionId: senderTx.id,
            recipientTransactionId: recipientTx.id,
            amount: transferAmount,
            currency: dto.currency,
            recipientIdentifierType: this.getRecipientIdentifierType(dto),
            recipientMaskedIdentifier: this.maskRecipient(transferRecipient),
            response,
          });

          await tx.auditLog.create({
            data: {
              action: 'internal_transfer_completed',
              targetType: 'INTERNAL_TRANSFER',
              targetId: attempt.id,
              reference: transferReference,
              before: { status: 'PROCESSING' },
              after: {
                status: 'SUCCESS',
                amount: transferAmount.toString(),
                currency: dto.currency,
              },
              metadata: {
                actorUserId: sender.id,
                recipientUserId: transferRecipient.id,
                senderTransactionId: senderTx.id,
                recipientTransactionId: recipientTx.id,
                requestId: context.requestId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                idempotencyKeyDigest: keyHash.slice(0, 12),
                recipientMaskedIdentifier:
                  this.maskRecipient(transferRecipient),
              },
            },
          });

          return response;
        },
        { maxWait: 2_000, timeout: 5_000 },
      );

      await this.postCommitHook.afterCommit(result);

      this.logger.info(
        {
          userId: sender.id,
          recipientUserId: transferRecipient.id,
          reference: transferReference,
          amount: transferAmount.toString(),
          currency: dto.currency,
          requestId: context.requestId,
          idempotencyKeyDigest: keyHash.slice(0, 12),
        },
        'Internal transfer completed',
      );

      return result;
    } catch (error) {
      if (error instanceof TransferPostCommitFault) {
        throw error;
      }
      if (this.idempotency.isBusinessKeyConflict(error)) {
        const replay = await this.idempotency.findReplay(
          userId,
          keyHash,
          requestHash,
        );
        if (replay) {
          return replay;
        }
      }

      await this.recordFailedAttempt(
        userId,
        dto,
        amount,
        recipient,
        error,
        requestHash,
        context,
      );
      throw error;
    }
  }

  async getInternalTransferByReference(userId: string, reference: string) {
    const transfer = await this.prisma.transaction.findFirst({
      where: {
        userId,
        type: 'INTERNAL_TRANSFER',
        OR: [
          { reference },
          {
            metadata: {
              path: ['transferReference'],
              equals: reference,
            },
          },
        ],
      },
      select: {
        id: true,
        reference: true,
        type: true,
        amount: true,
        currency: true,
        status: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }

    const metadata = (transfer.metadata || {}) as Record<string, unknown>;
    const transferReference =
      (metadata.transferReference as string | undefined) || transfer.reference;
    const attempt = await this.prisma.internalTransferAttempt.findFirst({
      where: {
        transferReference,
        OR: [{ userId }, { recipientUserId: userId }],
      },
      select: {
        reversal: {
          select: { status: true, reversalReference: true },
        },
      },
    });

    return {
      reference: transferReference,
      transactionReference: transfer.reference,
      type: transfer.type,
      direction: metadata.direction,
      status: transfer.status,
      amount: transfer.amount,
      currency: transfer.currency,
      fee: '0',
      counterparty: {
        maskedIdentifier: metadata.counterpartyMaskedIdentifier,
      },
      note: metadata.note,
      reversalStatus: attempt?.reversal?.status ?? null,
      reversalReference: attempt?.reversal?.reversalReference ?? null,
      createdAt: transfer.createdAt,
      updatedAt: transfer.updatedAt,
    };
  }

  async previewRecipient(userId: string, dto: RecipientPreviewDto) {
    const startedAtMs = Date.now();
    const identifier = this.getRecipientIdentifierValue(dto);

    try {
      this.assertSingleRecipientIdentifier(dto);

      const sender = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          kycStatus: true,
          kycTier: true,
          isSuspended: true,
        },
      });

      if (!sender) {
        throw new NotFoundException('User not found');
      }

      this.assertUserCanTransfer(sender, 'sender');

      const recipient = await this.findRecipient(dto);
      if (!recipient) {
        return this.unavailableRecipientPreview(userId, identifier);
      }

      if (recipient.id === sender.id) {
        throw new BadRequestException('Cannot transfer to yourself');
      }

      if (!this.isRecipientEligible(recipient)) {
        return this.unavailableRecipientPreview(userId, identifier);
      }

      return {
        found: true as const,
        displayName: this.maskDisplayName(recipient.fullName),
        maskedIdentifier: this.maskRecipient(recipient),
        avatarInitials: this.getAvatarInitials(recipient),
      };
    } finally {
      const delayMs = recipientPreviewDelayMs(startedAtMs, identifier);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private unavailableRecipientPreview(userId: string, identifier: string) {
    this.logger.warn(
      {
        event: 'RECIPIENT_ENUMERATION_SIGNAL',
        actorUserId: userId,
        identifierDigest: createHash('sha256')
          .update(identifier)
          .digest('hex')
          .slice(0, 12),
      },
      'Recipient preview returned the uniform unavailable response',
    );
    return { found: false as const };
  }

  private getRecipientIdentifierValue(dto: RecipientIdentifiers) {
    return (
      dto.recipientId ??
      dto.recipientEmail?.trim().toLowerCase() ??
      dto.recipientPhone?.trim() ??
      'invalid-recipient-input'
    );
  }

  private isRecipientEligible(user: {
    kycStatus: string;
    kycTier?: KYCTier | null;
    isSuspended: boolean;
  }) {
    return (
      !user.isSuspended &&
      user.kycStatus === 'VERIFIED' &&
      isKycTierAtLeast(user.kycTier, 'TIER_1')
    );
  }

  private findRecipient(dto: RecipientIdentifiers) {
    const where = dto.recipientId
      ? { id: dto.recipientId }
      : dto.recipientEmail
        ? { email: dto.recipientEmail.toLowerCase() }
        : { phone: dto.recipientPhone };

    return this.prisma.user.findFirst({
      where,
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
      },
    });
  }

  private assertSingleRecipientIdentifier(dto: RecipientIdentifiers) {
    const identifiers = [
      dto.recipientId,
      dto.recipientEmail,
      dto.recipientPhone,
    ].filter(Boolean);

    if (identifiers.length !== 1) {
      throw new BadRequestException('Provide exactly one recipient identifier');
    }
  }

  private assertUserCanTransfer(
    user: {
      kycStatus: string;
      kycTier?: KYCTier | null;
      isSuspended: boolean;
    },
    role: 'sender' | 'recipient',
  ) {
    if (user.isSuspended) {
      throw new ForbiddenException(`${role} is not eligible for transfer`);
    }

    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException(`${role} must have verified KYC`);
    }

    if (!isKycTierAtLeast(user.kycTier, 'TIER_1')) {
      throw new ForbiddenException(
        `${role} must be at least ${formatKycTier('TIER_1')} for transfers`,
      );
    }
  }

  private async reserveTransferLimitUsage(
    tx: Pick<Prisma.TransactionClient, 'internalTransferLimitUsage'>,
    userId: string,
    currency: 'NGN' | 'GHS',
    amount: Decimal,
    policy: Pick<ActiveInternalTransferLimitPolicy, 'daily' | 'monthly'>,
  ) {
    const now = new Date();
    await this.reservePeriodLimit(tx, {
      userId,
      currency,
      amount,
      period: 'DAILY',
      periodStart: this.startOfUtcDay(now),
      limit: policy.daily,
    });
    await this.reservePeriodLimit(tx, {
      userId,
      currency,
      amount,
      period: 'MONTHLY',
      periodStart: this.startOfUtcMonth(now),
      limit: policy.monthly,
    });
  }

  private async reservePeriodLimit(
    tx: Pick<Prisma.TransactionClient, 'internalTransferLimitUsage'>,
    input: {
      userId: string;
      currency: 'NGN' | 'GHS';
      amount: Decimal;
      period: 'DAILY' | 'MONTHLY';
      periodStart: Date;
      limit: Decimal;
    },
  ) {
    await tx.internalTransferLimitUsage.upsert({
      where: {
        userId_currency_period_periodStart: {
          userId: input.userId,
          currency: input.currency,
          period: input.period,
          periodStart: input.periodStart,
        },
      },
      create: {
        userId: input.userId,
        currency: input.currency,
        period: input.period,
        periodStart: input.periodStart,
        amount: new Decimal(0),
      },
      update: { updatedAt: new Date() },
    });

    const updated = await tx.internalTransferLimitUsage.updateMany({
      where: {
        userId: input.userId,
        currency: input.currency,
        period: input.period,
        periodStart: input.periodStart,
        amount: { lte: input.limit.minus(input.amount) },
      },
      data: { amount: { increment: input.amount } },
    });

    if (updated.count !== 1) {
      throw new BadRequestException(
        `${input.period.toLowerCase()} internal transfer limit exceeded`,
      );
    }
  }

  private startOfUtcDay(date: Date) {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private startOfUtcMonth(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  private assertRecipientCanReceive(user: {
    kycStatus: string;
    kycTier?: KYCTier | null;
    isSuspended: boolean;
  }) {
    if (
      user.isSuspended ||
      user.kycStatus !== 'VERIFIED' ||
      !isKycTierAtLeast(user.kycTier, 'TIER_1')
    ) {
      throw new NotFoundException('Recipient cannot be found or used');
    }
  }

  private maskRecipient(user: {
    email?: string | null;
    phone?: string | null;
  }) {
    if (user.email) {
      return maskEmail(user.email);
    }

    if (user.phone) {
      return maskPhone(user.phone);
    }

    return 'TRUSTPAY user';
  }

  private getRecipientIdentifierType(dto: InternalTransferDto) {
    if (dto.recipientId) return 'USER_ID';
    if (dto.recipientEmail) return 'EMAIL';
    if (dto.recipientPhone) return 'PHONE';
    return undefined;
  }

  private getProvidedRecipientMaskedIdentifier(dto: InternalTransferDto) {
    if (dto.recipientEmail) return maskEmail(dto.recipientEmail);
    if (dto.recipientPhone) return maskPhone(dto.recipientPhone);
    if (dto.recipientId) return 'TRUSTPAY user';
    return undefined;
  }

  private getFailureCode(error: unknown) {
    if (error instanceof NotFoundException) return 'NOT_FOUND';
    if (error instanceof ForbiddenException) return 'FORBIDDEN';
    if (error instanceof BadRequestException) return 'BAD_REQUEST';
    return 'UNEXPECTED_ERROR';
  }

  private getSafeFailureMessage(error: unknown) {
    if (
      error instanceof BadRequestException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException
    ) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        return Array.isArray(message) ? message.join(', ') : String(message);
      }
    }

    return 'Internal transfer failed';
  }

  private async recordFailedAttempt(
    userId: string,
    dto: InternalTransferDto,
    amount: Decimal | undefined,
    recipient: {
      id: string;
      email?: string | null;
      phone?: string | null;
    } | null,
    error: unknown,
    requestHash: string,
    context: InternalTransferRequestContext,
  ) {
    try {
      await this.prisma.internalTransferAttempt.create({
        data: {
          userId,
          recipientUserId: recipient?.id,
          status: 'FAILED',
          amount,
          currency: dto.currency,
          recipientIdentifierType: this.getRecipientIdentifierType(dto),
          recipientMaskedIdentifier: recipient
            ? this.maskRecipient(recipient)
            : this.getProvidedRecipientMaskedIdentifier(dto),
          requestHash,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          failureCode: this.getFailureCode(error),
          failureMessage: this.getSafeFailureMessage(error),
        },
      });
    } catch (logError) {
      this.logger.warn(
        {
          userId,
          requestId: context.requestId,
          error: logError instanceof Error ? logError.message : 'Unknown error',
        },
        'Failed to record internal transfer attempt',
      );
    }
  }

  private getAvatarInitials(user: {
    email?: string | null;
    phone?: string | null;
    fullName?: string | null;
  }) {
    const source = user.fullName?.trim() || user.email || user.phone || 'T';
    return source.slice(0, 1).toUpperCase();
  }

  private maskDisplayName(fullName?: string | null) {
    // "Paul Nwosu Chukwu" -> "Paul N. C." — enough for the sender to confirm
    // the recipient without exposing the full legal name pre-transfer.
    const normalized = fullName?.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    const [first, ...rest] = normalized.split(' ');
    if (rest.length === 0) {
      return first;
    }

    const initials = rest
      .map((part) => `${part.charAt(0).toUpperCase()}.`)
      .join(' ');

    return `${first} ${initials}`;
  }
}
