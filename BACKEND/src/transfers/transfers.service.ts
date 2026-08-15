import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { KYCTier, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
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
import { maskEmail, maskPhone } from '../common/utils/masking';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { formatKycTier, isKycTierAtLeast } from '../common/utils/kyc-tier';

const INTERNAL_TRANSFER_LIMITS: Record<
  'TIER_2' | 'TIER_3',
  { perTransaction: Decimal; daily: Decimal; monthly: Decimal }
> = {
  TIER_2: {
    perTransaction: new Decimal(250_000),
    daily: new Decimal(1_000_000),
    monthly: new Decimal(5_000_000),
  },
  TIER_3: {
    perTransaction: new Decimal(1_000_000),
    daily: new Decimal(5_000_000),
    monthly: new Decimal(20_000_000),
  },
};

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly logger: PinoLogger,
    private readonly transactionPin: TransactionPinService,
  ) {}

  async sendInternalTransfer(userId: string, dto: InternalTransferDto) {
    let amount: Decimal | undefined;
    let recipient: {
      id: string;
      email?: string | null;
      phone?: string | null;
      kycStatus: string;
      kycTier?: KYCTier | null;
      isSuspended: boolean;
    } | null = null;

    try {
      await this.transactionPin.verifyRequired(userId, dto.transactionPin);
      this.assertSingleRecipientIdentifier(dto);

      amount = new Decimal(dto.amount);
      if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Amount must be positive');
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
      this.assertTransferAmountWithinLimit(amount, sender.kycTier);

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

      const result = await this.prisma.$transaction(async (tx) => {
        await this.reserveTransferLimitUsage(
          tx,
          sender.id,
          dto.currency,
          transferAmount,
          sender.kycTier,
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

        await tx.internalTransferAttempt.create({
          data: {
            userId: sender.id,
            recipientUserId: transferRecipient.id,
            transferReference,
            senderTransactionId: senderTx.id,
            recipientTransactionId: recipientTx.id,
            status: 'SUCCESS',
            amount: transferAmount,
            currency: dto.currency,
            recipientIdentifierType: this.getRecipientIdentifierType(dto),
            recipientMaskedIdentifier: this.maskRecipient(transferRecipient),
          },
        });

        return {
          reference: transferReference,
          senderTransactionReference: senderReference,
          recipientTransactionReference: recipientReference,
          senderBalanceAfter: senderLedger.balanceAfter,
          recipientBalanceAfter: recipientLedger.balanceAfter,
        };
      });

      this.logger.info(
        {
          userId: sender.id,
          recipientUserId: transferRecipient.id,
          reference: transferReference,
          amount: transferAmount.toString(),
          currency: dto.currency,
        },
        'Internal transfer completed',
      );

      return {
        reference: result.reference,
        status: 'SUCCESS',
        amount: transferAmount.toString(),
        currency: dto.currency,
        senderTransactionReference: result.senderTransactionReference,
        senderBalanceAfter: result.senderBalanceAfter.toString(),
        recipient: {
          maskedIdentifier: this.maskRecipient(transferRecipient),
          avatarInitials: this.getAvatarInitials(transferRecipient),
        },
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      await this.recordFailedAttempt(userId, dto, amount, recipient, error);
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

    return {
      reference:
        (metadata.transferReference as string | undefined) ||
        transfer.reference,
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
      createdAt: transfer.createdAt,
      updatedAt: transfer.updatedAt,
    };
  }

  async previewRecipient(userId: string, dto: RecipientPreviewDto) {
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
      throw new NotFoundException('Recipient cannot be found or used');
    }

    if (recipient.id === sender.id) {
      throw new BadRequestException('Cannot transfer to yourself');
    }

    this.assertRecipientCanReceive(recipient);

    return {
      found: true,
      displayName: this.maskDisplayName(recipient.fullName),
      maskedIdentifier: this.maskRecipient(recipient),
      avatarInitials: this.getAvatarInitials(recipient),
    };
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

    if (!isKycTierAtLeast(user.kycTier, 'TIER_2')) {
      throw new ForbiddenException(
        `${role} must be at least ${formatKycTier('TIER_2')} for transfers`,
      );
    }
  }

  private assertTransferAmountWithinLimit(
    amount: Decimal,
    tier?: KYCTier | null,
  ) {
    const limits = this.getTransferLimits(tier);

    if (amount.greaterThan(limits.perTransaction)) {
      throw new BadRequestException(
        `Internal transfer limit exceeded. Maximum per transfer: ${limits.perTransaction.toFixed(2)}`,
      );
    }
  }

  private async reserveTransferLimitUsage(
    tx: Pick<Prisma.TransactionClient, 'internalTransferLimitUsage'>,
    userId: string,
    currency: 'NGN' | 'GHS',
    amount: Decimal,
    tier?: KYCTier | null,
  ) {
    const limits = this.getTransferLimits(tier);
    const now = new Date();
    await this.reservePeriodLimit(tx, {
      userId,
      currency,
      amount,
      period: 'DAILY',
      periodStart: this.startOfUtcDay(now),
      limit: limits.daily,
    });
    await this.reservePeriodLimit(tx, {
      userId,
      currency,
      amount,
      period: 'MONTHLY',
      periodStart: this.startOfUtcMonth(now),
      limit: limits.monthly,
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

  private getTransferLimits(tier?: KYCTier | null) {
    return tier === 'TIER_3'
      ? INTERNAL_TRANSFER_LIMITS.TIER_3
      : INTERNAL_TRANSFER_LIMITS.TIER_2;
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
      !isKycTierAtLeast(user.kycTier, 'TIER_2')
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
          failureCode: this.getFailureCode(error),
          failureMessage: this.getSafeFailureMessage(error),
        },
      });
    } catch (logError) {
      this.logger.warn(
        {
          userId,
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
