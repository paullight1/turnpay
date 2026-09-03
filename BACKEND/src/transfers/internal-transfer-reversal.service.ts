import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import { InternalTransferRequestContext } from './internal-transfer-request-context';
import { InternalTransferReversalReasonDto } from './dto/internal-transfer-reversal.dto';
import type { RequestAuditContext } from '../common/services/request-audit-context';

@Injectable()
export class InternalTransferReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly logger: PinoLogger,
  ) {}

  async requestReversal(
    reference: string,
    dto: InternalTransferReversalReasonDto,
    adminId: string,
    context: InternalTransferRequestContext,
  ) {
    const idempotencyKeyHash = this.hash(context.idempotencyKey);
    const requestHash = this.hash(
      JSON.stringify({ reference, reason: dto.reason.trim() }),
    );
    const replay = await this.prisma.internalTransferReversal.findUnique({
      where: {
        requesterAdminId_idempotencyKeyHash: {
          requesterAdminId: adminId,
          idempotencyKeyHash,
        },
      },
    });
    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key was already used for a different reversal request',
        );
      }
      return replay;
    }

    const attempt = await this.prisma.internalTransferAttempt.findFirst({
      where: { transferReference: reference, status: 'SUCCESS' },
    });
    if (
      !attempt ||
      !attempt.recipientUserId ||
      !attempt.senderTransactionId ||
      !attempt.recipientTransactionId ||
      !attempt.amount ||
      !attempt.currency
    ) {
      throw new NotFoundException('Completed internal transfer not found');
    }

    const existing = await this.prisma.internalTransferReversal.findUnique({
      where: { originalAttemptId: attempt.id },
    });
    if (existing) {
      throw new ConflictException(
        'A reversal already exists for this transfer',
      );
    }

    await this.assertOriginalTransferIntegrity(attempt);

    try {
      const reversal = await this.prisma.$transaction(
        async (tx) => {
          const created = await tx.internalTransferReversal.create({
            data: {
              originalAttemptId: attempt.id,
              originalTransferReference: reference,
              originalSenderTransactionId: attempt.senderTransactionId!,
              originalRecipientTransactionId: attempt.recipientTransactionId!,
              amount: attempt.amount!,
              currency: attempt.currency!,
              senderUserId: attempt.userId,
              recipientUserId: attempt.recipientUserId!,
              requesterAdminId: adminId,
              requestReason: dto.reason.trim(),
              idempotencyKeyHash,
              requestHash,
              requestId: context.requestId,
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
            },
          });
          await tx.auditLog.create({
            data: {
              adminId,
              action: 'internal_transfer_reversal_requested',
              targetType: 'InternalTransferReversal',
              targetId: created.id,
              reference,
              reason: dto.reason.trim(),
              after: this.reversalAuditSnapshot(created),
              metadata: {
                requestId: context.requestId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                idempotencyKeyDigest: idempotencyKeyHash.slice(0, 12),
              },
            },
          });
          return created;
        },
        { maxWait: 2_000, timeout: 5_000 },
      );

      this.logger.info(
        { adminId, reversalId: reversal.id, reference },
        'Internal transfer reversal requested',
      );
      return reversal;
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const raced = await this.prisma.internalTransferReversal.findFirst({
          where: {
            OR: [
              { originalAttemptId: attempt.id },
              { requesterAdminId: adminId, idempotencyKeyHash },
            ],
          },
        });
        if (raced?.requestHash === requestHash) return raced;
        throw new ConflictException(
          'A reversal already exists for this transfer',
        );
      }
      throw error;
    }
  }

  async approveReversal(
    reversalId: string,
    dto: InternalTransferReversalReasonDto,
    adminId: string,
    auditContext?: RequestAuditContext,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const reversal = await tx.internalTransferReversal.findUnique({
            where: { id: reversalId },
          });
          if (!reversal) throw new NotFoundException('Reversal not found');
          if (reversal.requesterAdminId === adminId) {
            throw new ForbiddenException(
              'The requesting administrator cannot approve this reversal',
            );
          }
          if (reversal.status !== 'PENDING_APPROVAL') {
            throw new ConflictException('Reversal is not pending approval');
          }

          const now = new Date();
          const claimed = await tx.internalTransferReversal.updateMany({
            where: { id: reversalId, status: 'PENDING_APPROVAL' },
            data: {
              approverAdminId: adminId,
              reviewReason: dto.reason.trim(),
              approvedAt: now,
            },
          });
          if (claimed.count !== 1) {
            throw new ConflictException(
              'Reversal was already claimed by another administrator',
            );
          }

          const reversalReference = `ITR-${Date.now()}-${uuidv4().slice(0, 8)}`;
          const recipientReference = `${reversalReference}-DEBIT`;
          const senderReference = `${reversalReference}-CREDIT`;
          const recipientTx = await tx.transaction.create({
            data: {
              userId: reversal.recipientUserId,
              type: 'INTERNAL_TRANSFER',
              amount: reversal.amount,
              currency: reversal.currency,
              status: 'REVERSED',
              reference: recipientReference,
              metadata: {
                direction: 'OUT',
                reversalReference,
                originalTransferReference: reversal.originalTransferReference,
                counterpartyUserId: reversal.senderUserId,
              },
            },
          });
          const senderTx = await tx.transaction.create({
            data: {
              userId: reversal.senderUserId,
              type: 'INTERNAL_TRANSFER',
              amount: reversal.amount,
              currency: reversal.currency,
              status: 'REVERSED',
              reference: senderReference,
              metadata: {
                direction: 'IN',
                reversalReference,
                originalTransferReference: reversal.originalTransferReference,
                counterpartyUserId: reversal.recipientUserId,
              },
            },
          });

          const recipientDebit = await this.ledger.debitWallet(
            {
              userId: reversal.recipientUserId,
              currency: reversal.currency,
              amount: reversal.amount,
              transactionId: recipientTx.id,
              reference: reversalReference,
              source: 'INTERNAL_TRANSFER_REVERSAL_DEBIT',
              metadata: {
                originalTransferReference: reversal.originalTransferReference,
              },
            },
            tx,
          );
          const senderCredit = await this.ledger.creditWallet(
            {
              userId: reversal.senderUserId,
              currency: reversal.currency,
              amount: reversal.amount,
              transactionId: senderTx.id,
              reference: reversalReference,
              source: 'INTERNAL_TRANSFER_REVERSAL_CREDIT',
              metadata: {
                originalTransferReference: reversal.originalTransferReference,
              },
            },
            tx,
          );

          await tx.transaction.update({
            where: { id: recipientTx.id },
            data: { walletId: recipientDebit.walletId },
          });
          await tx.transaction.update({
            where: { id: senderTx.id },
            data: { walletId: senderCredit.walletId },
          });

          const completed = await tx.internalTransferReversal.update({
            where: { id: reversalId },
            data: {
              status: 'COMPLETED',
              reversalReference,
              reversalRecipientTransactionId: recipientTx.id,
              reversalSenderTransactionId: senderTx.id,
              completedAt: now,
            },
          });
          await tx.auditLog.create({
            data: {
              adminId,
              action: 'internal_transfer_reversal_completed',
              targetType: 'InternalTransferReversal',
              targetId: reversalId,
              reference: reversalReference,
              reason: dto.reason.trim(),
              before: this.reversalAuditSnapshot(reversal),
              after: this.reversalAuditSnapshot(completed),
              metadata: {
                ...this.requestAuditMetadata(auditContext),
                originalTransferReference: reversal.originalTransferReference,
                recipientBalanceAfter: recipientDebit.balanceAfter.toString(),
                senderBalanceAfter: senderCredit.balanceAfter.toString(),
              },
            },
          });
          return completed;
        },
        { maxWait: 2_000, timeout: 5_000 },
      );
    } catch (error) {
      if (!this.isInsufficientBalance(error)) throw error;

      return this.prisma.$transaction(
        async (tx) => {
          const blockedAt = new Date();
          const blockedClaim = await tx.internalTransferReversal.updateMany({
            where: { id: reversalId, status: 'PENDING_APPROVAL' },
            data: {
              status: 'BLOCKED',
              approverAdminId: adminId,
              reviewReason: dto.reason.trim(),
              blockedAt,
            },
          });
          if (blockedClaim.count !== 1) {
            throw new ConflictException('Reversal is no longer pending');
          }
          const blocked = await tx.internalTransferReversal.update({
            where: { id: reversalId },
            data: { status: 'BLOCKED' },
          });
          await tx.auditLog.create({
            data: {
              adminId,
              action: 'internal_transfer_reversal_blocked',
              targetType: 'InternalTransferReversal',
              targetId: reversalId,
              reason:
                'Recipient wallet has insufficient funds for full reversal',
              after: this.reversalAuditSnapshot(blocked),
              metadata: this.requestAuditMetadata(auditContext),
            },
          });
          return blocked;
        },
        { maxWait: 2_000, timeout: 5_000 },
      );
    }
  }

  async rejectReversal(
    reversalId: string,
    dto: InternalTransferReversalReasonDto,
    adminId: string,
    auditContext?: RequestAuditContext,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const reversal = await tx.internalTransferReversal.findUnique({
          where: { id: reversalId },
        });
        if (!reversal) throw new NotFoundException('Reversal not found');
        if (reversal.requesterAdminId === adminId) {
          throw new ForbiddenException(
            'The requesting administrator cannot review this reversal',
          );
        }
        const claimed = await tx.internalTransferReversal.updateMany({
          where: { id: reversalId, status: 'PENDING_APPROVAL' },
          data: {
            status: 'REJECTED',
            reviewerAdminId: adminId,
            reviewReason: dto.reason.trim(),
            rejectedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('Reversal is not pending approval');
        }
        const rejected = await tx.internalTransferReversal.update({
          where: { id: reversalId },
          data: { status: 'REJECTED' },
        });
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'internal_transfer_reversal_rejected',
            targetType: 'InternalTransferReversal',
            targetId: reversalId,
            reason: dto.reason.trim(),
            before: this.reversalAuditSnapshot(reversal),
            after: this.reversalAuditSnapshot(rejected),
            metadata: this.requestAuditMetadata(auditContext),
          },
        });
        return rejected;
      },
      { maxWait: 2_000, timeout: 5_000 },
    );
  }

  listReversals() {
    return this.prisma.internalTransferReversal.findMany({
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
  }

  getReversal(id: string) {
    return this.prisma.internalTransferReversal.findUniqueOrThrow({
      where: { id },
    });
  }

  private async assertOriginalTransferIntegrity(attempt: {
    senderTransactionId: string | null;
    recipientTransactionId: string | null;
    userId: string;
    recipientUserId: string | null;
    amount: Decimal | null;
    currency: 'NGN' | 'GHS' | null;
  }) {
    const transactions = await this.prisma.transaction.findMany({
      where: {
        id: {
          in: [attempt.senderTransactionId!, attempt.recipientTransactionId!],
        },
      },
      select: { id: true, userId: true, amount: true, currency: true },
    });
    const sender = transactions.find(
      ({ id }) => id === attempt.senderTransactionId,
    );
    const recipient = transactions.find(
      ({ id }) => id === attempt.recipientTransactionId,
    );
    if (
      !sender ||
      !recipient ||
      sender.userId !== attempt.userId ||
      recipient.userId !== attempt.recipientUserId ||
      sender.currency !== attempt.currency ||
      recipient.currency !== attempt.currency ||
      !sender.amount.equals(attempt.amount!) ||
      !recipient.amount.equals(attempt.amount!)
    ) {
      throw new ConflictException('Original transfer records are inconsistent');
    }
  }

  private reversalAuditSnapshot(reversal: Record<string, unknown>) {
    const snapshot = { ...reversal };
    delete snapshot.idempotencyKeyHash;
    delete snapshot.requestHash;
    delete snapshot.ipAddress;
    delete snapshot.userAgent;
    return snapshot as Prisma.InputJsonValue;
  }

  private requestAuditMetadata(context?: RequestAuditContext) {
    if (!context) return undefined;
    return {
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent ?? null,
      actorId: context.actorId ?? null,
    };
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private isUniqueConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isInsufficientBalance(error: unknown) {
    return (
      error instanceof Error &&
      error.message.toLowerCase().includes('insufficient')
    );
  }
}
