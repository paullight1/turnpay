import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementHoldService } from '../common/services/settlement-hold.service';
import { isKycTierAtLeast } from '../common/utils/kyc-tier';
import { toMinorUnit } from '../payments/utils/provider-amount';
import { PaystackTransferApprovalDto } from './paystack-transfer-approval.dto';

const includeReservation = {
  transaction: {
    include: {
      user: { select: { isSuspended: true, kycStatus: true, kycTier: true } },
    },
  },
} as const;
type Reservation = Prisma.TransferAttemptGetPayload<{
  include: typeof includeReservation;
}>;
type Intent = {
  recipient: string;
  expiresAt: number;
  signature: string;
  approvedAt?: string;
};

/**
 * This is an authorization decision, never a settlement webhook. Paystack's
 * approval contract does not document an inbound signature. Authenticate the
 * instruction by matching it to a server-sealed, PIN-authorized reservation.
 * Settlement events still go through the separate signed webhook/verify path.
 */
@Injectable()
export class PaystackTransferApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly hold: SettlementHoldService,
  ) {}

  get enabled() {
    const flag = this.config.get<unknown>('PAYSTACK_TRANSFER_APPROVAL_ENABLED');
    return flag === true || flag === 'true';
  }

  /** Must commit BEFORE the provider receives POST /transfer. */
  async prepare(body: PaystackTransferApprovalDto): Promise<void> {
    const payload = this.validate(body);
    await this.decide(payload, true);
  }

  async approve(body: unknown): Promise<{ approved: true }> {
    const payload = this.validate(body);
    await this.decide(payload, false);
    return { approved: true };
  }

  /** Called only AFTER an authenticated provider lookup explicitly returns 404.
   * The caller holds the transaction row lock through the compensating refund.
   * Expiry alone, a timeout, or an already-approved intent is never refundable.
   */
  async isExpiredUnapproved(reference: string, tx: Prisma.TransactionClient) {
    const attempt = await tx.transferAttempt.findUnique({
      where: {
        provider_providerReference: {
          provider: 'PAYSTACK',
          providerReference: reference,
        },
      },
      include: includeReservation,
    });
    if (
      !attempt ||
      attempt.status !== 'PENDING' ||
      attempt.transaction.status !== 'PENDING' ||
      attempt.transaction.type !== 'WITHDRAW'
    )
      return false;
    const entries = await tx.ledgerEntry.findMany({
      where: { transactionId: attempt.transactionId },
    });
    const debit = entries.find(
      (entry) => entry.source === 'WITHDRAWAL' && entry.direction === 'DEBIT',
    );
    if (
      !debit ||
      debit.walletId !== attempt.transaction.walletId ||
      debit.currency !== attempt.transaction.currency ||
      !debit.amount.eq(attempt.transaction.amount) ||
      entries.some((entry) => entry.source === 'WITHDRAWAL_REVERSAL')
    )
      return false;
    const stored = this.record(this.record(attempt.metadata).transferApproval);
    if (
      stored.approvedAt ||
      typeof stored.expiresAt !== 'number' ||
      stored.expiresAt > Date.now() ||
      typeof stored.recipient !== 'string' ||
      typeof stored.signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(stored.signature)
    )
      return false;
    try {
      const payload = this.validate({
        reference,
        amount: toMinorUnit(attempt.transaction.amount),
        currency: attempt.transaction.currency,
        source: 'balance',
        recipient: stored.recipient,
      });
      const expected = this.seal(payload, stored.expiresAt, attempt);
      return timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(stored.signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  private validate(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) this.reject();
    const payload = plainToInstance(PaystackTransferApprovalDto, body);
    // Paystack may append non-authorizing fields such as reason. Only these
    // five documented financial fields participate in the approval decision.
    if (validateSync(payload, { whitelist: true }).length) this.reject();
    return payload;
  }

  private async decide(
    payload: PaystackTransferApprovalDto,
    preparing: boolean,
  ) {
    const execution = this.config.get<unknown>('WITHDRAWALS_ENABLED');
    if (!this.enabled || (execution !== true && execution !== 'true'))
      this.reject();
    await this.prisma.$transaction(
      async (tx) => {
        const where = {
          provider_providerReference: {
            provider: 'PAYSTACK' as const,
            providerReference: payload.reference,
          },
        };
        const initial = await tx.transferAttempt.findUnique({
          where,
          select: { transactionId: true },
        });
        if (!initial) this.reject();
        // Use the same transaction row that settlement/refund transitions update.
        // Re-read after locking; do not decide from a stale pre-lock snapshot.
        await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${initial.transactionId} FOR UPDATE`;
        const attempt = await tx.transferAttempt.findUnique({
          where,
          include: includeReservation,
        });
        if (!attempt) this.reject();
        const transaction = attempt.transaction;
        if (
          attempt.status !== 'PENDING' ||
          transaction.status !== 'PENDING' ||
          transaction.type !== 'WITHDRAW' ||
          transaction.currency !== 'NGN' ||
          transaction.reference !== payload.reference ||
          toMinorUnit(transaction.amount) !== payload.amount ||
          transaction.user.isSuspended ||
          transaction.user.kycStatus !== 'VERIFIED' ||
          !isKycTierAtLeast(transaction.user.kycTier, 'TIER_1')
        )
          this.reject();
        const entries = await tx.ledgerEntry.findMany({
          where: { transactionId: transaction.id },
        });
        const debit = entries.find(
          (entry) =>
            entry.source === 'WITHDRAWAL' && entry.direction === 'DEBIT',
        );
        if (
          !debit ||
          debit.walletId !== transaction.walletId ||
          debit.currency !== transaction.currency ||
          !debit.amount.eq(transaction.amount) ||
          entries.some((entry) => entry.source === 'WITHDRAWAL_REVERSAL')
        )
          this.reject();
        await this.hold.assertOutboundAllowed(
          {
            operation: 'WITHDRAWAL',
            userId: transaction.userId,
            reference: payload.reference,
            currency: 'NGN',
            provider: 'PAYSTACK',
          },
          tx,
        );

        const metadata = this.record(attempt.metadata);
        const stored = this.record(metadata.transferApproval);
        if (preparing && !Object.keys(stored).length) {
          if (attempt.providerStatus !== 'RESERVED') this.reject();
          const intent: Intent = {
            recipient: payload.recipient,
            expiresAt: Date.now() + 300_000,
            signature: '',
          };
          intent.signature = this.seal(payload, intent.expiresAt, attempt);
          await tx.transferAttempt.update({
            where: { id: attempt.id },
            data: {
              metadata: {
                ...metadata,
                transferApproval: intent,
              },
            },
          });
          await tx.auditLog.create({
            data: {
              action: 'PAYSTACK_TRANSFER_APPROVAL_PREPARED',
              targetType: 'Transaction',
              targetId: transaction.id,
              reference: payload.reference,
              metadata: {
                amount: transaction.amount.toFixed(2),
                currency: 'NGN',
                expiresAt: intent.expiresAt,
              },
            },
          });
          return;
        }
        if (
          typeof stored.expiresAt !== 'number' ||
          stored.expiresAt <= Date.now() ||
          stored.expiresAt > Date.now() + 300_000 ||
          stored.recipient !== payload.recipient ||
          typeof stored.signature !== 'string' ||
          !/^[a-f0-9]{64}$/.test(stored.signature)
        )
          this.reject();
        const expected = this.seal(payload, stored.expiresAt, attempt);
        if (
          !timingSafeEqual(
            Buffer.from(expected, 'hex'),
            Buffer.from(stored.signature, 'hex'),
          )
        )
          this.reject();
        // Provider retries approve the same still-pending instruction; they cannot
        // re-arm it, extend expiry or create another transfer or wallet debit.
        if (!preparing && !stored.approvedAt) {
          await tx.transferAttempt.update({
            where: { id: attempt.id },
            data: {
              metadata: {
                ...metadata,
                transferApproval: {
                  ...stored,
                  approvedAt: new Date().toISOString(),
                },
              },
            },
          });
          await tx.auditLog.create({
            data: {
              action: 'PAYSTACK_TRANSFER_AUTO_APPROVED',
              targetType: 'Transaction',
              targetId: transaction.id,
              reference: payload.reference,
              metadata: {
                userId: transaction.userId,
                amount: transaction.amount.toFixed(2),
                currency: 'NGN',
              },
            },
          });
        }
      },
      { maxWait: 500, timeout: 2000 },
    );
  }

  private seal(
    payload: PaystackTransferApprovalDto,
    expiresAt: number,
    attempt: Reservation,
  ) {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim();
    if (!key || !/^sk_(live|test)_\S+$/.test(key)) this.reject();
    return createHmac('sha256', key)
      .update(
        JSON.stringify([
          'trustpay-transfer-approval-v1',
          payload.reference,
          payload.amount,
          payload.currency,
          payload.source,
          payload.recipient,
          expiresAt,
          attempt.transactionId,
          attempt.transaction.userId,
          attempt.transaction.walletId,
        ]),
      )
      .digest('hex');
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private reject(): never {
    throw new BadRequestException('Transfer approval rejected');
  }
}
