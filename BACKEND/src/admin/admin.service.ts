import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminActionReasonDto,
  AdminTransferVerificationDto,
  AdminUpdateUserDto,
} from './dto/admin.dto';
import { PinoLogger } from 'nestjs-pino';
import { Prisma, ProviderEventStatus, TransactionStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../wallets/ledger.service';
import { PaystackProvider } from '../payments/providers/paystack.provider';
import { FlutterwaveProvider } from '../payments/providers/flutterwave.provider';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    private readonly ledger: LedgerService,
    private readonly paystack: PaystackProvider,
    private readonly flutterwave: FlutterwaveProvider,
    private readonly supabaseService: SupabaseService,
  ) {}

  async getUsers(
    page: number,
    limit: number,
    role?: string,
    kycStatus?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};

    if (role) where.role = role;
    if (kycStatus) where.kycStatus = kycStatus;

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
          kycStatus: true,
          isSuspended: true,
          createdAt: true,
          wallets: {
            select: {
              currency: true,
              balance: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        kycStatus: true,
        isSuspended: true,
        createdAt: true,
        updatedAt: true,
        wallets: true,
        transactions: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            amount: true,
            currency: true,
            status: true,
            reference: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateUser(userId: string, dto: AdminUpdateUserDto, adminId: string) {
    this.assertReason(dto.reason);
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    const { reason, ...updates } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: updates,
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
          kycStatus: true,
          isSuspended: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'USER_UPDATE',
          targetType: 'User',
          targetId: userId,
          reason,
          before: this.sanitizeMetadata(existing) as Prisma.InputJsonValue,
          after: this.sanitizeMetadata(updatedUser) as Prisma.InputJsonValue,
          metadata: { fields: Object.keys(updates) },
        },
      });

      return updatedUser;
    });

    this.logger.info(
      { adminId, userId, changes: Object.keys(updates) },
      'Admin updated user',
    );

    if (updates.role) {
      try {
        await this.supabaseService.setAuthAppRole(userId, updates.role);
      } catch (error) {
        this.logger.warn(
          {
            adminId,
            userId,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Unable to sync Supabase app_metadata role after admin role update',
        );
      }
    }

    return updated;
  }

  async suspendUser(
    userId: string,
    adminId: string,
    dto: AdminActionReasonDto,
  ) {
    return this.updateUser(
      userId,
      { isSuspended: true, reason: dto.reason },
      adminId,
    );
  }

  async unsuspendUser(
    userId: string,
    adminId: string,
    dto: AdminActionReasonDto,
  ) {
    return this.updateUser(
      userId,
      { isSuspended: false, reason: dto.reason },
      adminId,
    );
  }

  async getStats() {
    const [
      totalUsers,
      totalTransactions,
      volumeResult,
      feeResult,
      activeUsers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.transaction.count(),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { status: 'SUCCESS' },
      }),
      this.prisma.transaction.aggregate({
        _sum: { fee: true },
        where: { status: 'SUCCESS' },
      }),
      this.prisma.user.count({
        where: {
          transactions: {
            some: {
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              },
            },
          },
        },
      }),
    ]);

    return {
      totalUsers,
      totalTransactions,
      totalVolume: Number(volumeResult._sum.amount || 0),
      totalFees: Number(feeResult._sum.fee || 0),
      activeUsers,
    };
  }

  async getRecentTransactions(limit = 20) {
    return this.prisma.transaction.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
          },
        },
      },
    });
  }

  updateTransactionStatus(
    reference: string,
    status: TransactionStatus,
    adminId: string,
  ) {
    this.logger.warn(
      { adminId, reference, requestedStatus: status },
      'Blocked generic admin transaction status update',
    );
    throw new BadRequestException(
      'Generic transaction status updates are disabled. Use a typed audited banking operation.',
    );
  }

  async getBankingOverview() {
    const staleCutoff = this.getStalePendingCutoff();

    const [
      activeVirtualAccounts,
      failedVirtualAccounts,
      pendingWithdrawals,
      stalePendingTransfers,
      failedProviderEvents,
      failedTransferAttempts,
    ] = await Promise.all([
      this.prisma.virtualAccount.count({ where: { status: 'ACTIVE' } }),
      this.prisma.virtualAccount.count({ where: { status: 'FAILED' } }),
      this.prisma.transaction.count({
        where: { type: 'WITHDRAW', status: 'PENDING' },
      }),
      this.prisma.transferAttempt.count({
        where: { status: 'PENDING', createdAt: { lt: staleCutoff } },
      }),
      this.prisma.providerEvent.count({ where: { status: 'FAILED' } }),
      this.prisma.transferAttempt.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      virtualAccounts: {
        active: activeVirtualAccounts,
        failed: failedVirtualAccounts,
      },
      withdrawals: {
        pending: pendingWithdrawals,
        stalePending: stalePendingTransfers,
        failedAttempts: failedTransferAttempts,
      },
      providerEvents: {
        failed: failedProviderEvents,
      },
      generatedAt: new Date(),
    };
  }

  async getVirtualAccounts(limit = 50) {
    return this.prisma.virtualAccount.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        provider: true,
        providerAccountId: true,
        accountNumberMasked: true,
        accountName: true,
        bankName: true,
        bankCode: true,
        currency: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getProviderEvents(limit = 50, status?: string) {
    const events = await this.prisma.providerEvent.findMany({
      take: limit,
      where: status ? { status: status as ProviderEventStatus } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        eventType: true,
        providerReference: true,
        status: true,
        payload: true,
        payloadHash: true,
        errorMessage: true,
        processedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return events.map((event) => ({
      ...event,
      payload: this.sanitizeMetadata(event.payload),
    }));
  }

  async getPendingWithdrawals(limit = 50) {
    const withdrawals = await this.prisma.transaction.findMany({
      take: limit,
      where: {
        type: 'WITHDRAW',
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        amount: true,
        currency: true,
        status: true,
        reference: true,
        fee: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            kycStatus: true,
            isSuspended: true,
          },
        },
        transferAttempts: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
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
    });

    return withdrawals.map((withdrawal) => ({
      ...withdrawal,
      metadata: this.sanitizeMetadata(withdrawal.metadata),
      transferAttempts: withdrawal.transferAttempts.map((attempt) => ({
        ...attempt,
        metadata: this.sanitizeMetadata(attempt.metadata),
      })),
    }));
  }

  async verifyTransfer(
    reference: string,
    dto: AdminTransferVerificationDto,
    adminId: string,
  ) {
    this.assertReason(dto.reason);

    const transaction = await this.prisma.transaction.findUnique({
      where: { reference },
      include: {
        transferAttempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!transaction || transaction.type !== 'WITHDRAW') {
      throw new NotFoundException('Withdrawal not found');
    }

    const latestAttempt = transaction.transferAttempts[0];
    if (!latestAttempt) {
      throw new BadRequestException('Withdrawal has no transfer attempt');
    }

    const providerVerification =
      await this.verifyProviderTransfer(latestAttempt);
    const verifiedStatus = this.mapTransferStatus(
      providerVerification.providerStatus,
    );

    if (['SUCCESS', 'REVERSED'].includes(transaction.status)) {
      throw new BadRequestException('Terminal withdrawal cannot be changed');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const before = {
        status: transaction.status,
        transferAttempt: transaction.transferAttempts[0]
          ? {
              status: transaction.transferAttempts[0].status,
              providerStatus: transaction.transferAttempts[0].providerStatus,
            }
          : null,
      };

      const updatedStatus = await tx.transaction.updateMany({
        where: {
          id: transaction.id,
          status: transaction.status,
        },
        data: { status: verifiedStatus },
      });

      await tx.transferAttempt.update({
        where: { id: latestAttempt.id },
        data: {
          status: verifiedStatus,
          providerStatus: providerVerification.providerStatus,
          lastCheckedAt: new Date(),
          metadata: {
            ...(latestAttempt.metadata &&
            typeof latestAttempt.metadata === 'object' &&
            !Array.isArray(latestAttempt.metadata)
              ? (latestAttempt.metadata as Record<string, unknown>)
              : {}),
            providerVerification: this.sanitizeMetadata(
              providerVerification.payload,
            ),
          } as Prisma.InputJsonValue,
        },
      });

      const shouldReverse =
        updatedStatus.count === 1 &&
        ['FAILED', 'REVERSED'].includes(verifiedStatus);

      if (shouldReverse) {
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
                adminId,
                reason: dto.reason,
                providerStatus: providerVerification.providerStatus,
              },
            },
            tx,
          );
        }
      }

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'TRANSFER_VERIFY',
          targetType: 'Transaction',
          targetId: transaction.id,
          reference,
          reason: dto.reason,
          before,
          after: {
            status: verifiedStatus,
            providerStatus: providerVerification.providerStatus,
          },
          metadata: {
            reversed:
              ['FAILED', 'REVERSED'].includes(verifiedStatus) &&
              updatedStatus.count === 1,
          },
        },
      });

      return tx.transaction.findUnique({
        where: { id: transaction.id },
        include: {
          transferAttempts: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    });

    this.logger.info(
      { adminId, reference, status: verifiedStatus },
      'Admin verified withdrawal transfer',
    );

    return result;
  }

  async getReconciliationReport() {
    const staleCutoff = this.getStalePendingCutoff();

    const [providerEvents, transactions, localOnlyWithdrawals, stalePending] =
      await Promise.all([
        this.prisma.providerEvent.findMany({
          take: 200,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            provider: true,
            eventType: true,
            providerReference: true,
            status: true,
            payload: true,
            createdAt: true,
          },
        }),
        this.prisma.transaction.findMany({
          take: 200,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            reference: true,
            type: true,
            amount: true,
            currency: true,
            status: true,
          },
        }),
        this.prisma.transaction.findMany({
          where: {
            type: 'WITHDRAW',
            transferAttempts: { none: {} },
          },
          take: 100,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            reference: true,
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.transferAttempt.findMany({
          where: {
            status: 'PENDING',
            createdAt: { lt: staleCutoff },
          },
          take: 100,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            transactionId: true,
            provider: true,
            providerReference: true,
            providerStatus: true,
            status: true,
            createdAt: true,
            lastCheckedAt: true,
          },
        }),
      ]);

    const transactionByReference = new Map(
      transactions.map((transaction) => [transaction.reference, transaction]),
    );

    const providerOnlyEvents = providerEvents
      .filter((event) => !transactionByReference.has(event.providerReference))
      .map((event) => ({
        id: event.id,
        provider: event.provider,
        eventType: event.eventType,
        providerReference: event.providerReference,
        status: event.status,
        createdAt: event.createdAt,
      }));

    const amountMismatches = providerEvents.flatMap((event) => {
      const transaction = transactionByReference.get(event.providerReference);
      const providerAmount = this.extractProviderAmount(event.payload);

      if (!transaction || providerAmount === null) {
        return [];
      }

      if (!new Decimal(transaction.amount).equals(providerAmount)) {
        return [
          {
            providerReference: event.providerReference,
            providerAmount,
            localAmount: transaction.amount,
            localStatus: transaction.status,
            eventType: event.eventType,
          },
        ];
      }

      return [];
    });

    return {
      generatedAt: new Date(),
      summary: {
        providerOnlyEvents: providerOnlyEvents.length,
        localWithdrawalsWithoutTransferAttempt: localOnlyWithdrawals.length,
        amountMismatches: amountMismatches.length,
        stalePendingTransfers: stalePending.length,
      },
      providerOnlyEvents,
      localWithdrawalsWithoutTransferAttempt: localOnlyWithdrawals,
      amountMismatches,
      stalePendingTransfers: stalePending,
    };
  }

  async runReconciliation(adminId: string, dto: AdminActionReasonDto) {
    this.assertReason(dto.reason);
    const report = await this.getReconciliationReport();

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'RECONCILIATION_RUN',
        targetType: 'ReconciliationReport',
        targetId: `report-${Date.now()}`,
        reason: dto.reason,
        after: report,
        metadata: { summary: report.summary },
      },
    });

    return report;
  }

  async getAuditLogs(limit = 50) {
    const logs = await this.prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        adminId: true,
        action: true,
        targetType: true,
        targetId: true,
        reference: true,
        reason: true,
        before: true,
        after: true,
        metadata: true,
        createdAt: true,
      },
    });

    return logs.map((log) => ({
      ...log,
      before: this.sanitizeMetadata(log.before),
      after: this.sanitizeMetadata(log.after),
      metadata: this.sanitizeMetadata(log.metadata),
    }));
  }

  private async verifyProviderTransfer(latestAttempt: {
    provider: 'PAYSTACK' | 'FLUTTERWAVE';
    providerReference: string;
    metadata: unknown;
  }) {
    if (latestAttempt.provider === 'PAYSTACK') {
      const transfer = await this.paystack.verifyTransfer(
        latestAttempt.providerReference,
      );

      return {
        providerStatus: transfer.status,
        payload: transfer,
      };
    }

    const metadata =
      latestAttempt.metadata &&
      typeof latestAttempt.metadata === 'object' &&
      !Array.isArray(latestAttempt.metadata)
        ? (latestAttempt.metadata as Record<string, unknown>)
        : {};
    const providerTransferId = Number(metadata.providerTransferId);

    if (!Number.isFinite(providerTransferId)) {
      throw new BadRequestException(
        'Flutterwave transfer id is required for provider verification',
      );
    }

    const transfer = await this.flutterwave.verifyTransfer(providerTransferId);

    return {
      providerStatus: transfer.status,
      payload: transfer,
    };
  }

  private mapTransferStatus(status: string): TransactionStatus {
    const normalized = status.toLowerCase();

    if (
      ['success', 'successful', 'completed', 'complete'].includes(normalized)
    ) {
      return 'SUCCESS';
    }

    if (normalized === 'reversed') {
      return 'REVERSED';
    }

    if (['failed', 'abandoned', 'blocked', 'rejected'].includes(normalized)) {
      return 'FAILED';
    }

    return 'PENDING';
  }

  private assertReason(reason: string) {
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException(
        'A reason of at least 10 characters is required',
      );
    }
  }

  private getStalePendingCutoff() {
    return new Date(Date.now() - 30 * 60 * 1000);
  }

  private extractProviderAmount(payload: unknown): Decimal | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const eventPayload = payload as { data?: { amount?: unknown } };
    const rawAmount = eventPayload.data?.amount;

    if (rawAmount === undefined || rawAmount === null) {
      return null;
    }

    if (typeof rawAmount !== 'string' && typeof rawAmount !== 'number') {
      return null;
    }

    const decimalAmount = new Decimal(rawAmount);
    if (!decimalAmount.isFinite()) {
      return null;
    }

    return decimalAmount;
  }

  private sanitizeMetadata(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
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
    delete safeMetadata.password;
    delete safeMetadata.secret;

    return safeMetadata;
  }
}
