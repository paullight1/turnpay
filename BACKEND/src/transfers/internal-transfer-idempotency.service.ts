import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InternalTransferDto } from './dto/internal-transfer.dto';
import { InternalTransferRequestContext } from './internal-transfer-request-context';

export type InternalTransferResponse = {
  reference: string;
  status: 'SUCCESS';
  amount: string;
  currency: 'NGN' | 'GHS';
  senderTransactionReference: string;
  senderBalanceAfter: string;
  recipient: {
    maskedIdentifier: string;
    avatarInitials: string;
  };
  createdAt: string;
};

type TransferAttemptClient = Pick<
  Prisma.TransactionClient,
  'internalTransferAttempt'
>;

@Injectable()
export class InternalTransferIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hashKey(key: string) {
    return createHash('sha256').update(key).digest('hex');
  }

  fingerprint(dto: InternalTransferDto) {
    const businessRequest = {
      recipientId: dto.recipientId?.trim() || null,
      recipientEmail: dto.recipientEmail?.trim().toLowerCase() || null,
      recipientPhone: dto.recipientPhone?.trim() || null,
      amount: new Decimal(dto.amount).toFixed(2),
      currency: dto.currency,
      note: dto.note ?? null,
    };

    return createHash('sha256')
      .update(JSON.stringify(businessRequest))
      .digest('hex');
  }

  async findReplay(userId: string, keyHash: string, requestHash: string) {
    const attempt = await this.prisma.internalTransferAttempt.findUnique({
      where: {
        userId_idempotencyKeyHash: {
          userId,
          idempotencyKeyHash: keyHash,
        },
      },
      select: {
        status: true,
        requestHash: true,
        response: true,
      },
    });

    if (!attempt) {
      return null;
    }

    if (attempt.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different internal transfer',
      );
    }

    if (attempt.status !== 'SUCCESS' || attempt.response == null) {
      throw new ConflictException(
        'Transfer with this idempotency key is already in progress',
      );
    }

    return attempt.response as InternalTransferResponse;
  }

  createProcessing(
    tx: TransferAttemptClient,
    input: {
      userId: string;
      keyHash: string;
      requestHash: string;
      context: InternalTransferRequestContext;
    },
  ) {
    return tx.internalTransferAttempt.create({
      data: {
        userId: input.userId,
        status: 'PROCESSING',
        idempotencyKeyHash: input.keyHash,
        requestHash: input.requestHash,
        requestId: input.context.requestId,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      },
      select: { id: true },
    });
  }

  async complete(
    tx: TransferAttemptClient,
    attemptId: string,
    data: {
      recipientUserId: string;
      transferReference: string;
      senderTransactionId: string;
      recipientTransactionId: string;
      amount: Decimal;
      currency: 'NGN' | 'GHS';
      recipientIdentifierType?: string;
      recipientMaskedIdentifier: string;
      response: InternalTransferResponse;
    },
  ) {
    await tx.internalTransferAttempt.update({
      where: { id: attemptId },
      data: {
        recipientUserId: data.recipientUserId,
        transferReference: data.transferReference,
        senderTransactionId: data.senderTransactionId,
        recipientTransactionId: data.recipientTransactionId,
        status: 'SUCCESS',
        amount: data.amount,
        currency: data.currency,
        recipientIdentifierType: data.recipientIdentifierType,
        recipientMaskedIdentifier: data.recipientMaskedIdentifier,
        response: data.response,
      },
    });
  }

  isBusinessKeyConflict(error: unknown) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.includes('userId') && target.includes('idempotencyKeyHash');
    }

    return (
      typeof target === 'string' &&
      target.includes('internal_transfer_attempts_user_idempotency_key')
    );
  }
}
