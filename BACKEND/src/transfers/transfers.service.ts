import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import { InternalTransferDto } from './dto/internal-transfer.dto';
import { maskEmail, maskPhone } from '../common/utils/masking';

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly logger: PinoLogger,
  ) {}

  async sendInternalTransfer(userId: string, dto: InternalTransferDto) {
    this.assertSingleRecipientIdentifier(dto);

    const amount = new Decimal(dto.amount);
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
        isSuspended: true,
      },
    });

    if (!sender) {
      throw new NotFoundException('User not found');
    }

    this.assertUserCanTransfer(sender, 'sender');

    const recipient = await this.findRecipient(dto);
    if (!recipient) {
      throw new NotFoundException('Recipient not found');
    }

    if (recipient.id === sender.id) {
      throw new BadRequestException('Cannot transfer to yourself');
    }

    this.assertRecipientCanReceive(recipient);

    const transferReference = `IT-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const senderReference = `${transferReference}-OUT`;
    const recipientReference = `${transferReference}-IN`;

    const result = await this.prisma.$transaction(async (tx) => {
      const senderTx = await tx.transaction.create({
        data: {
          userId: sender.id,
          type: 'INTERNAL_TRANSFER',
          amount,
          currency: dto.currency,
          status: 'SUCCESS',
          reference: senderReference,
          metadata: {
            direction: 'OUT',
            transferReference,
            counterpartyUserId: recipient.id,
            counterpartyMaskedIdentifier: this.maskRecipient(recipient),
            note: dto.note,
          },
        },
      });

      const recipientTx = await tx.transaction.create({
        data: {
          userId: recipient.id,
          type: 'INTERNAL_TRANSFER',
          amount,
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
          amount,
          transactionId: senderTx.id,
          reference: transferReference,
          source: 'INTERNAL_TRANSFER_OUT',
          metadata: {
            recipientUserId: recipient.id,
          },
        },
        tx,
      );

      const recipientLedger = await this.ledger.creditWallet(
        {
          userId: recipient.id,
          currency: dto.currency,
          amount,
          transactionId: recipientTx.id,
          reference: transferReference,
          source: 'INTERNAL_TRANSFER_IN',
          metadata: {
            senderUserId: sender.id,
          },
        },
        tx,
      );

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
        recipientUserId: recipient.id,
        reference: transferReference,
        amount: amount.toString(),
        currency: dto.currency,
      },
      'Internal transfer completed',
    );

    return {
      reference: result.reference,
      status: 'SUCCESS',
      amount: amount.toString(),
      currency: dto.currency,
      senderTransactionReference: result.senderTransactionReference,
      senderBalanceAfter: result.senderBalanceAfter.toString(),
      recipient: {
        maskedIdentifier: this.maskRecipient(recipient),
        avatarInitials: this.getAvatarInitials(recipient),
      },
      createdAt: new Date().toISOString(),
    };
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

  private findRecipient(dto: InternalTransferDto) {
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
        kycStatus: true,
        isSuspended: true,
      },
    });
  }

  private assertSingleRecipientIdentifier(dto: InternalTransferDto) {
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
    user: { kycStatus: string; isSuspended: boolean },
    role: 'sender' | 'recipient',
  ) {
    if (user.isSuspended) {
      throw new ForbiddenException(`${role} is not eligible for transfer`);
    }

    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException(`${role} must have verified KYC`);
    }
  }

  private assertRecipientCanReceive(user: {
    kycStatus: string;
    isSuspended: boolean;
  }) {
    if (user.isSuspended || user.kycStatus !== 'VERIFIED') {
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

  private getAvatarInitials(user: {
    email?: string | null;
    phone?: string | null;
  }) {
    const source = user.email || user.phone || 'T';
    return source.slice(0, 1).toUpperCase();
  }
}
