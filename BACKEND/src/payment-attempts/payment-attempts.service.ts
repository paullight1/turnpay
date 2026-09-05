import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentAttemptResolutionDto,
  ResolvePaymentAttemptDto,
} from './payment-attempts.dto';

@Injectable()
export class PaymentAttemptsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    userId: string,
    dto: ResolvePaymentAttemptDto,
  ): Promise<PaymentAttemptResolutionDto> {
    const key = createHash('sha256').update(dto.attemptKey).digest('hex');
    if (dto.operation === 'INTERNAL_TRANSFER') {
      const attempt = await this.prisma.internalTransferAttempt.findUnique({
        where: {
          userId_idempotencyKeyHash: { userId, idempotencyKeyHash: key },
        },
        select: {
          status: true,
          transferReference: true,
          reversal: { select: { status: true } },
        },
      });
      if (!attempt) return { state: 'UNKNOWN' };
      if (attempt.status === 'SUCCESS' && attempt.transferReference)
        return {
          state:
            attempt.reversal?.status === 'COMPLETED' ? 'REVERSED' : 'SUCCESS',
          reference: attempt.transferReference,
        };
      // A nonterminal record is evidence of an attempt, not permission to send again.
      return { state: attempt.status === 'PROCESSING' ? 'PENDING' : 'UNKNOWN' };
    }
    const path =
      dto.operation === 'WITHDRAWAL'
        ? '/api/payments/withdraw'
        : '/api/vtu/purchase';
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope: `${userId}:POST:${path}`, key } },
      select: { status: true, response: true, expiresAt: true },
    });
    if (
      !record ||
      record.expiresAt < new Date() ||
      record.status !== 'COMPLETED'
    )
      return { state: 'UNKNOWN' };
    const response = record.response;
    const reference =
      response && typeof response === 'object' && !Array.isArray(response)
        ? response.reference
        : undefined;
    if (typeof reference !== 'string' || !reference)
      return { state: 'UNKNOWN' };
    const types: TransactionType[] =
      dto.operation === 'WITHDRAWAL'
        ? ['WITHDRAW']
        : ['AIRTIME', 'DATA', 'CABLE', 'ELECTRICITY'];
    const transaction = await this.prisma.transaction.findFirst({
      where: { userId, reference, type: { in: types } },
      select: { status: true, reference: true },
    });
    return transaction
      ? { state: transaction.status, reference: transaction.reference }
      : { state: 'UNKNOWN' };
  }
}
