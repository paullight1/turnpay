import { PaystackFundingService } from '../payments/paystack-funding.service';
import { PaymentService } from '../payments/payment.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminActionReasonDto,
  AdminAuditLogsQueryDto,
  AdminCreateVtuPricingRuleDto,
  AdminTransferVerificationDto,
  AdminUpdateVtuPricingRuleDto,
  AdminUpdateUserDto,
} from './dto/admin.dto';
import { PinoLogger } from 'nestjs-pino';
import {
  ExchangePayoutStatus,
  ExchangeReceiptStatus,
  InternalTransferLimitPolicy,
  Prisma,
  ProviderEventStatus,
  TransactionStatus,
  TransactionType,
  WalletCurrency,
  VtuOrderStatus,
  VtuOrderScope,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { LedgerService } from '../wallets/ledger.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  VtuService,
  VTU_ACTION_REQUIRED_CODE,
  VTU_REQUERY_MAX_ATTEMPTS,
} from '../vtu/vtu.service';
import { BankingService } from '../banking/banking.service';
import { maskAccountNumber } from '../common/utils/masking';
import {
  ApproveInternalTransferLimitPolicyDto,
  CreateInternalTransferLimitPolicyDto,
  InternalTransferLimitPolicyQueryDto,
} from './dto/internal-transfer-limit-policy.dto';
import type { RequestAuditContext } from '../common/services/request-audit-context';

const STALE_VTU_STATUSES: VtuOrderStatus[] = [
  'PENDING',
  'PROCESSING',
  'UNKNOWN',
];
const USER_SERVICE_ORDER: TransactionType[] = [
  'AIRTIME',
  'DATA',
  'CABLE',
  'ELECTRICITY',
  'EXCHANGE',
  'FUND',
  'WITHDRAW',
  'INTERNAL_TRANSFER',
];
const PLATFORM_SERVICE_TREND_DAYS = 7;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    private readonly ledger: LedgerService,
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly vtuService: VtuService,
    private readonly bankingService: BankingService,
    @Optional() private readonly paystackFunding?: PaystackFundingService,
    @Optional() private readonly payments?: PaymentService,
  ) {}

  async getUsers(
    page: number,
    limit: number,
    role?: string,
    kycStatus?: string,
    q?: string,
  ) {
    const skip = (page - 1) * limit;
    const whereClauses: Prisma.UserWhereInput[] = [];

    if (role)
      whereClauses.push({ role: role as Prisma.UserWhereInput['role'] });
    if (kycStatus) {
      whereClauses.push({
        kycStatus: kycStatus as Prisma.UserWhereInput['kycStatus'],
      });
    }

    if (q) {
      whereClauses.push({
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { fullName: { contains: q, mode: 'insensitive' } },
          { referralCode: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    const where = whereClauses.length > 0 ? { AND: whereClauses } : undefined;

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
          fullName: true,
          role: true,
          kycStatus: true,
          kycTier: true,
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
        fullName: true,
        role: true,
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
        createdAt: true,
        updatedAt: true,
        wallets: {
          orderBy: { currency: 'asc' },
          select: {
            id: true,
            currency: true,
            balance: true,
            updatedAt: true,
          },
        },
        virtualAccounts: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
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
        },
        bankAccounts: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            provider: true,
            bankCode: true,
            bankName: true,
            accountName: true,
            accountNumberMasked: true,
            currency: true,
            isDeleted: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        refreshTokens: {
          where: {
            revokedAt: null,
            expiresAt: {
              gt: new Date(),
            },
          },
          orderBy: { lastUsedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            deviceId: true,
            deviceName: true,
            userAgent: true,
            ipAddress: true,
            lastUsedAt: true,
            expiresAt: true,
            createdAt: true,
          },
        },
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
        disputes: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            status: true,
            description: true,
            resolution: true,
            createdAt: true,
            updatedAt: true,
            transaction: {
              select: {
                id: true,
                reference: true,
                type: true,
                amount: true,
                currency: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
        exchangeReceipts: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            bankReference: true,
            amount: true,
            expectedCreditAmount: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            transaction: {
              select: {
                id: true,
                reference: true,
                type: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
        exchangePayouts: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            sourceAmount: true,
            destinationAmount: true,
            destinationBankName: true,
            destinationAccountNumber: true,
            destinationAccountName: true,
            reviewedAt: true,
            sentAt: true,
            createdAt: true,
            updatedAt: true,
            transaction: {
              select: {
                id: true,
                reference: true,
                type: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { refreshTokens, exchangePayouts, ...rest } = user;
    const relatedAuditClauses: Prisma.AuditLogWhereInput[] = [
      { targetType: 'User', targetId: userId },
      {
        metadata: {
          path: ['userId'],
          equals: userId,
        },
      },
    ];

    const addTargetClause = (targetType: string, targetIds: string[]) => {
      if (targetIds.length > 0) {
        relatedAuditClauses.push({
          targetType,
          targetId: { in: targetIds },
        });
      }
    };

    addTargetClause(
      'Transaction',
      user.transactions.map((transaction) => transaction.id),
    );
    addTargetClause(
      'UserSession',
      refreshTokens.map((session) => session.id),
    );
    addTargetClause(
      'Dispute',
      user.disputes.map((dispute) => dispute.id),
    );
    addTargetClause(
      'ExchangeReceipt',
      user.exchangeReceipts.map((receipt) => receipt.id),
    );
    addTargetClause(
      'ExchangePayout',
      exchangePayouts.map((payout) => payout.id),
    );

    const [auditLogs, serviceRows] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { OR: relatedAuditClauses },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          adminId: true,
          admin: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
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
      }),
      this.prisma.transaction.groupBy({
        by: ['type', 'currency'],
        where: { userId },
        _count: { _all: true },
        _sum: {
          amount: true,
          fee: true,
        },
        _max: {
          createdAt: true,
        },
      }),
    ]);

    const serviceStats = serviceRows
      .map((entry) => ({
        type: entry.type,
        currency: entry.currency,
        transactionCount: entry._count._all,
        totalAmount: this.toDecimalOrZero(entry._sum.amount).toFixed(2),
        totalFees: this.toDecimalOrZero(entry._sum.fee).toFixed(2),
        lastActivityAt: entry._max.createdAt?.toISOString() ?? null,
      }))
      .sort((left, right) => {
        const orderDiff =
          USER_SERVICE_ORDER.indexOf(left.type) -
          USER_SERVICE_ORDER.indexOf(right.type);

        if (orderDiff !== 0) {
          return orderDiff;
        }

        return (
          new Date(right.lastActivityAt ?? 0).getTime() -
          new Date(left.lastActivityAt ?? 0).getTime()
        );
      });

    return {
      ...rest,
      sessions: refreshTokens,
      serviceStats,
      auditLogs: auditLogs.map((log) => ({
        ...log,
        before: this.sanitizeMetadata(log.before),
        after: this.sanitizeMetadata(log.after),
        metadata: this.sanitizeMetadata(log.metadata),
      })),
      exchangePayouts: exchangePayouts.map((payout) => ({
        ...payout,
        destinationAccountNumber: maskAccountNumber(
          payout.destinationAccountNumber,
        ),
      })),
    };
  }

  async revokeUserSession(
    userId: string,
    sessionId: string,
    dto: AdminActionReasonDto,
    adminId: string,
  ) {
    this.assertReason(dto.reason);

    const session = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, userId },
      select: {
        id: true,
        userId: true,
        providerSessionId: true,
        deviceId: true,
        deviceName: true,
        userAgent: true,
        ipAddress: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.revokedAt) {
      return { success: true };
    }

    const revokedAt = new Date();
    let sessionRevoked = false;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          OR: [
            { id: sessionId },
            ...(session.providerSessionId
              ? [{ providerSessionId: session.providerSessionId }]
              : []),
          ],
        },
        data: { revokedAt },
      });

      if (updated.count === 0) {
        return;
      }

      sessionRevoked = true;
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'USER_SESSION_REVOKE',
          targetType: 'UserSession',
          targetId: sessionId,
          reference: session.deviceId,
          reason: dto.reason,
          before: this.toRefreshTokenAuditSnapshot(session),
          after: this.toRefreshTokenAuditSnapshot({
            ...session,
            revokedAt,
          }),
          metadata: {
            userId,
            deviceName: session.deviceName,
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
          },
        },
      });
    });

    if (sessionRevoked) {
      this.logger.info(
        { adminId, userId, sessionId, event: 'admin_user_session_revoked' },
        'Admin revoked user session',
      );
    }

    return { success: true };
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

    if (updates.dailyWithdrawLimit || updates.monthlyWithdrawLimit) {
      const nextDaily = new Decimal(
        updates.dailyWithdrawLimit ?? existing.dailyWithdrawLimit,
      );
      const nextMonthly = new Decimal(
        updates.monthlyWithdrawLimit ?? existing.monthlyWithdrawLimit,
      );

      if (nextMonthly.lessThan(nextDaily)) {
        throw new BadRequestException(
          'monthlyWithdrawLimit cannot be less than dailyWithdrawLimit',
        );
      }
    }

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
          kycTier: true,
          dailyWithdrawLimit: true,
          monthlyWithdrawLimit: true,
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

  async getTransactionDrilldown(reference: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { reference },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            kycStatus: true,
            kycTier: true,
            isSuspended: true,
            createdAt: true,
          },
        },
        wallet: {
          select: {
            id: true,
            currency: true,
            balance: true,
            updatedAt: true,
          },
        },
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            direction: true,
            amount: true,
            currency: true,
            balanceBefore: true,
            balanceAfter: true,
            reference: true,
            source: true,
            metadata: true,
            createdAt: true,
          },
        },
        transferAttempts: {
          orderBy: { createdAt: 'desc' },
        },
        vtuOrders: {
          orderBy: { createdAt: 'desc' },
        },
        exchangeReceipt: true,
        manualExchangeOrder: {
          select: {
            id: true,
            status: true,
            settlementMode: true,
            destinationInstitution: true,
            destinationAccount: true,
            destinationName: true,
            targetAmount: true,
            targetCurrency: true,
            proofKey: true,
            payoutProofKey: true,
          },
        },
        exchangePayout: {
          select: {
            destinationBankName: true,
            destinationAccountNumber: true,
            destinationAccountName: true,
            destinationAmount: true,
            destinationCurrency: true,
          },
        },
        disputes: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            status: true,
            description: true,
            resolution: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // Provider events are keyed by the provider's reference, which for
    // withdrawals lives on the transfer attempt rather than our reference.
    const candidateReferences = Array.from(
      new Set(
        [
          transaction.reference,
          ...transaction.transferAttempts.map(
            (attempt) => attempt.providerReference,
          ),
        ].filter((value): value is string => Boolean(value)),
      ),
    );

    const [providerEvents, auditTrail] = await Promise.all([
      this.prisma.providerEvent.findMany({
        where: { providerReference: { in: candidateReferences } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          provider: true,
          eventType: true,
          providerReference: true,
          status: true,
          errorMessage: true,
          processedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { targetId: transaction.id },
            { targetId: transaction.reference },
            { reference: transaction.reference },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          adminId: true,
          action: true,
          targetType: true,
          targetId: true,
          reference: true,
          reason: true,
          createdAt: true,
        },
      }),
    ]);

    const { manualExchangeOrder, ...transactionDetails } = transaction;
    return {
      ...this.sanitizeTransactionDrilldown(transactionDetails),
      manualExchange: manualExchangeOrder
        ? {
            id: manualExchangeOrder.id,
            status: manualExchangeOrder.status,
            settlementMode: manualExchangeOrder.settlementMode,
            destinationInstitution: manualExchangeOrder.destinationInstitution,
            destinationAccount: manualExchangeOrder.destinationAccount,
            destinationName: manualExchangeOrder.destinationName,
            targetAmount: manualExchangeOrder.targetAmount,
            targetCurrency: manualExchangeOrder.targetCurrency,
            hasProof: Boolean(manualExchangeOrder.proofKey),
            hasPayoutProof: Boolean(manualExchangeOrder.payoutProofKey),
          }
        : null,
      providerEvents,
      auditTrail,
    };
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
            kycTier: true,
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

  async getWithdrawalDrilldown(reference: string) {
    const transaction = await this.getTransactionDrilldown(reference);

    if (transaction.type !== 'WITHDRAW') {
      throw new NotFoundException('Withdrawal not found');
    }

    return transaction;
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

    if (latestAttempt.provider === 'PAYSTACK') {
      if (!this.payments)
        throw new BadRequestException('Payment verification is unavailable');
      const result = await this.payments.getWithdrawal(
        transaction.userId,
        reference,
      );
      await this.prisma.auditLog.create({
        data: {
          adminId,
          action: 'TRANSFER_VERIFY',
          targetType: 'Transaction',
          targetId: transaction.id,
          reference,
          reason: dto.reason,
          before: { status: transaction.status },
          after: { status: result.status },
        },
      });
      return result;
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

  async getReconciliationReport(from?: Date, to?: Date) {
    const staleCutoff = this.getStalePendingCutoff();
    const createdAtRange =
      from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {};

    const [
      providerEvents,
      transactions,
      localOnlyWithdrawals,
      stalePending,
      failedProviderEvents,
    ] = await Promise.all([
      this.prisma.providerEvent.findMany({
        where: { ...createdAtRange },
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
        where: { ...createdAtRange },
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
          ...createdAtRange,
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
          transaction: {
            select: {
              reference: true,
              status: true,
              amount: true,
              currency: true,
            },
          },
        },
      }),
      // Deposits whose webhook processing failed (e.g. lapsed KYC at credit
      // time) — money is at the provider but never credited. Replayable via
      // POST /admin/banking/deposits/:reference/replay.
      this.prisma.providerEvent.findMany({
        where: { status: 'FAILED', ...createdAtRange },
        take: 100,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          provider: true,
          eventType: true,
          providerReference: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
    ]);

    // Wallet balances vs net ledger movement must be compared over all time
    // regardless of the requested range: balances are cumulative state.
    const { walletTotals, ledgerTotals } = await this.prisma.$transaction(
      async (tx) => {
        const [walletTotals, ledgerTotals] = await Promise.all([
          tx.wallet.groupBy({
            by: ['currency'],
            _sum: { balance: true },
          }),
          tx.ledgerEntry.groupBy({
            by: ['currency', 'direction'],
            _sum: { amount: true },
          }),
        ]);
        return { walletTotals, ledgerTotals };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 5000,
        maxWait: 3000,
      },
    );

    const ledgerNetByCurrency = new Map<string, Decimal>();
    for (const row of ledgerTotals) {
      const amount = new Decimal(row._sum.amount ?? 0);
      const current = ledgerNetByCurrency.get(row.currency) ?? new Decimal(0);
      ledgerNetByCurrency.set(
        row.currency,
        row.direction === 'CREDIT'
          ? current.plus(amount)
          : current.minus(amount),
      );
    }

    const currencies = new Set<string>([
      ...walletTotals.map((row) => row.currency),
      ...ledgerNetByCurrency.keys(),
    ]);
    const walletLedgerReconciliation = Array.from(currencies)
      .sort()
      .map((currency) => {
        const walletTotal = new Decimal(
          walletTotals.find((row) => row.currency === currency)?._sum.balance ??
            0,
        );
        const ledgerNet = ledgerNetByCurrency.get(currency) ?? new Decimal(0);
        const drift = walletTotal.minus(ledgerNet);

        return {
          currency,
          walletTotal: walletTotal.toString(),
          ledgerNet: ledgerNet.toString(),
          drift: drift.toString(),
          inSync: drift.isZero(),
        };
      });

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
        failedProviderEvents: failedProviderEvents.length,
      },
      providerOnlyEvents,
      localWithdrawalsWithoutTransferAttempt: localOnlyWithdrawals,
      amountMismatches,
      stalePendingTransfers: stalePending,
      failedProviderEvents,
      walletLedgerReconciliation,
    };
  }

  async runReconciliation(adminId: string, dto: AdminActionReasonDto) {
    this.assertReason(dto.reason);
    const run = await this.prisma.reconciliationRun.create({
      data: {
        scope: 'ADMIN_BANKING',
        initiatedById: adminId,
      },
    });

    try {
      const report = await this.getReconciliationReport();
      const walletDriftCount = report.walletLedgerReconciliation.filter(
        (entry) => !entry.inSync,
      ).length;
      const mismatchCount =
        Object.values(report.summary).reduce(
          (total, count) => total + count,
          0,
        ) + walletDriftCount;
      const status = mismatchCount > 0 ? 'BLOCKED' : 'COMPLETED';

      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status,
          completedAt: new Date(),
          checkedCount: report.providerOnlyEvents.length,
          mismatchCount,
          mismatchDetails: this.sanitizeMetadata({
            summary: report.summary,
            walletLedgerReconciliation: report.walletLedgerReconciliation,
            amountMismatches: report.amountMismatches,
            stalePendingTransfers: report.stalePendingTransfers,
            failedProviderEvents: report.failedProviderEvents,
          }) as Prisma.InputJsonValue,
        },
      });

      if (status === 'BLOCKED') {
        this.logger.error(
          {
            alertCode: 'ADMIN_BANKING_RECONCILIATION_BLOCKED',
            reconciliationScope: 'ADMIN_BANKING',
            runId: run.id,
            mismatchCount,
          },
          'Admin banking reconciliation blocked outbound settlement',
        );
        Sentry.captureMessage(
          'Admin banking reconciliation blocked outbound settlement',
          {
            level: 'error',
            tags: {
              alertCode: 'ADMIN_BANKING_RECONCILIATION_BLOCKED',
              reconciliationScope: 'ADMIN_BANKING',
            },
            extra: { runId: run.id, mismatchCount },
          },
        );
      }

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
    } catch (error) {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async getReconciliationRuns(limit = 20) {
    return this.prisma.reconciliationRun.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        scope: true,
        status: true,
        initiatedById: true,
        startedAt: true,
        completedAt: true,
        checkedCount: true,
        mismatchCount: true,
        errorMessage: true,
        createdAt: true,
      },
    });
  }

  /**
   * Replays a Monnify virtual-account deposit whose webhook processing failed
   * (e.g. the user's KYC had lapsed when the money arrived). Reprocessing is
   * idempotent: an already-PROCESSED provider event is a no-op.
   */
  async replayVirtualAccountDeposit(
    reference: string,
    dto: AdminActionReasonDto,
    adminId: string,
  ) {
    this.assertReason(dto.reason);

    const webhookLog = await this.prisma.webhookLog.findFirst({
      where: {
        reference,
        eventType: { in: ['SUCCESSFUL_TRANSACTION', 'charge.success'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (webhookLog?.provider === 'PAYSTACK') {
      if (!this.paystackFunding)
        throw new BadRequestException('Payment verification is unavailable');
      const result = await this.paystackFunding.confirmCharge(reference);
      await this.prisma.webhookLog.update({
        where: { id: webhookLog.id },
        data: { processed: true, errorMessage: null },
      });
      await this.prisma.auditLog.create({
        data: {
          adminId,
          action: 'BANKING_DEPOSIT_REPLAY',
          targetType: 'WebhookLog',
          targetId: webhookLog.id,
          reference,
          reason: dto.reason,
          metadata: { provider: 'PAYSTACK' },
        },
      });
      return result;
    }

    if (!webhookLog || webhookLog.provider !== 'MONNIFY') {
      throw new NotFoundException(
        'No Monnify webhook log found for this reference',
      );
    }

    let replayPayload = webhookLog.payload;
    const loggedEvent = webhookLog.payload as {
      eventData?: {
        destinationAccountInformation?: { accountNumber?: string };
      };
    };
    if (
      loggedEvent.eventData?.destinationAccountInformation?.accountNumber ===
      '[REDACTED]'
    ) {
      const inbox = await this.prisma.paymentWebhookInbox.findFirst({
        where: {
          provider: 'MONNIFY',
          providerReference: reference,
          eventType: 'SUCCESSFUL_TRANSACTION',
        },
        orderBy: { receivedAt: 'desc' },
        select: { payload: true },
      });
      if (!inbox)
        throw new BadRequestException(
          'The signed deposit event is unavailable; reconcile this payment before replay',
        );
      replayPayload = inbox.payload;
    }
    const payload = replayPayload as {
      eventType?: string;
      eventData?: {
        transactionReference?: string;
        paymentReference?: string;
        paymentStatus?: string;
        amountPaid?: number;
        totalPayable?: number;
        settlementAmount?: number;
        currency?: string;
        destinationAccountInformation?: { accountNumber?: string };
      };
    };
    const data = payload?.eventData;
    const accountNumber = data?.destinationAccountInformation?.accountNumber;
    const amount = data?.amountPaid ?? data?.totalPayable;
    const providerReference =
      data?.transactionReference || data?.paymentReference || reference;

    if (
      payload?.eventType !== 'SUCCESSFUL_TRANSACTION' ||
      data?.paymentStatus !== 'PAID' ||
      !accountNumber ||
      !amount
    ) {
      throw new BadRequestException(
        'Webhook log is not a replayable virtual account deposit',
      );
    }

    const result = await this.bankingService.processVirtualAccountDeposit({
      provider: 'monnify',
      eventType: payload.eventType,
      providerReference,
      accountNumber,
      amount: new Decimal(amount),
      settlementAmount:
        data?.settlementAmount !== undefined
          ? new Decimal(data.settlementAmount)
          : undefined,
      currency: (data?.currency || 'NGN') as 'NGN' | 'GHS',
      rawPayload: replayPayload as Record<string, unknown>,
    });

    await this.prisma.webhookLog.update({
      where: { id: webhookLog.id },
      data: { processed: true, errorMessage: null },
    });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'BANKING_DEPOSIT_REPLAY',
        targetType: 'WebhookLog',
        targetId: webhookLog.id,
        reference: providerReference,
        reason: dto.reason,
        metadata: {
          accountNumberMasked: maskAccountNumber(accountNumber),
          amount: String(amount),
          result,
        },
      },
    });

    this.logger.info(
      { adminId, reference: providerReference, result },
      'Admin replayed virtual account deposit',
    );

    return result;
  }

  async getStaleVtuOrders(olderThanMinutes = 10, limit = 50) {
    if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < 1) {
      throw new BadRequestException('olderThanMinutes must be at least 1');
    }

    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const select = {
      id: true,
      provider: true,
      providerRequestId: true,
      providerTransactionId: true,
      providerStatus: true,
      status: true,
      scope: true,
      serviceType: true,
      countryCode: true,
      localProvider: true,
      operatorId: true,
      amount: true,
      currency: true,
      costAmount: true,
      providerCommission: true,
      fee: true,
      margin: true,
      targetMasked: true,
      requeryAttempts: true,
      lastRequeryAt: true,
      nextRequeryAt: true,
      createdAt: true,
      updatedAt: true,
      transaction: {
        select: {
          id: true,
          reference: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    } as const;
    const [actionRequiredOrders, staleOrders] = await Promise.all([
      // This is intentionally a direct threshold query. An old unresolved
      // order must not disappear just because a recent-order sample is full.
      this.prisma.vtuOrder.findMany({
        take: limit,
        where: {
          status: { in: STALE_VTU_STATUSES },
          requeryAttempts: { gte: VTU_REQUERY_MAX_ATTEMPTS },
          transaction: { status: 'PENDING' },
        },
        orderBy: [{ lastRequeryAt: 'asc' }, { createdAt: 'asc' }],
        select,
      }),
      this.prisma.vtuOrder.findMany({
        take: limit,
        where: {
          status: { in: STALE_VTU_STATUSES },
          requeryAttempts: { lt: VTU_REQUERY_MAX_ATTEMPTS },
          createdAt: { lt: cutoff },
          transaction: { status: 'PENDING' },
        },
        orderBy: [{ createdAt: 'asc' }],
        select,
      }),
    ]);
    const orders = Array.from(
      new Map(
        [...actionRequiredOrders, ...staleOrders].map((order) => [
          order.id,
          order,
        ]),
      ).values(),
    ).slice(0, limit);

    const mappedOrders = orders.map((order) => {
      const actionRequired =
        STALE_VTU_STATUSES.includes(order.status) &&
        order.transaction.status === 'PENDING' &&
        order.requeryAttempts >= VTU_REQUERY_MAX_ATTEMPTS;
      return {
        orderId: order.id,
        provider: order.provider,
        providerRequestId: order.providerRequestId,
        providerTransactionId: order.providerTransactionId,
        providerStatus: order.providerStatus,
        scope: order.scope,
        transactionId: order.transaction.id,
        transactionReference: order.transaction.reference,
        transactionStatus: order.transaction.status,
        serviceType: order.serviceType,
        countryCode: order.countryCode,
        localProvider: order.localProvider,
        operatorId: order.operatorId,
        amount: order.amount,
        currency: order.currency,
        costAmount: order.costAmount,
        providerCommission: order.providerCommission,
        fee: order.fee,
        margin: order.margin,
        status: order.status,
        targetMasked: order.targetMasked,
        attempts: order.requeryAttempts,
        lastRequeryAt: order.lastRequeryAt,
        nextRequeryAt: order.nextRequeryAt,
        actionRequired,
        actionRequiredCode: actionRequired ? VTU_ACTION_REQUIRED_CODE : null,
        actionRequiredReason: actionRequired
          ? 'Automatic provider checks stopped after the retry limit. Supervised manual recovery is required; no automatic refund or resend was issued.'
          : null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        transactionCreatedAt: order.transaction.createdAt,
        transactionUpdatedAt: order.transaction.updatedAt,
      };
    });
    return {
      generatedAt: new Date(),
      olderThanMinutes,
      cutoff,
      count: mappedOrders.length,
      actionRequiredCount: mappedOrders.filter((order) => order.actionRequired)
        .length,
      orders: mappedOrders,
    };
  }

  async getVtuProviderHealth() {
    return this.vtuService.getProviderHealth();
  }

  async getVtuReconciliationReport(olderThanMinutes = 10, limit = 50) {
    if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < 1) {
      throw new BadRequestException('olderThanMinutes must be at least 1');
    }

    const generatedAt = new Date();
    const cutoff = new Date(generatedAt.getTime() - olderThanMinutes * 60000);
    const select = {
      id: true,
      provider: true,
      providerRequestId: true,
      providerTransactionId: true,
      providerStatus: true,
      scope: true,
      serviceType: true,
      countryCode: true,
      localProvider: true,
      operatorId: true,
      amount: true,
      currency: true,
      costAmount: true,
      providerCommission: true,
      fee: true,
      margin: true,
      status: true,
      targetMasked: true,
      requeryAttempts: true,
      lastRequeryAt: true,
      nextRequeryAt: true,
      completedAt: true,
      failedAt: true,
      createdAt: true,
      updatedAt: true,
      transaction: {
        select: {
          id: true,
          reference: true,
          type: true,
          amount: true,
          fee: true,
          currency: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          ledgerEntries: {
            select: {
              id: true,
              direction: true,
              amount: true,
              currency: true,
              reference: true,
              source: true,
              createdAt: true,
            },
          },
        },
      },
    } as const;
    const [recentOrders, actionRequiredOrders, callbackFailures] =
      await Promise.all([
        this.prisma.vtuOrder.findMany({
          take: limit,
          orderBy: [{ createdAt: 'desc' }],
          select,
        }),
        // Keep exhausted unresolved obligations visible even when the recent
        // reconciliation sample is filled with newer rows.
        this.prisma.vtuOrder.findMany({
          take: limit,
          where: {
            status: { in: STALE_VTU_STATUSES },
            requeryAttempts: { gte: VTU_REQUERY_MAX_ATTEMPTS },
            transaction: { status: 'PENDING' },
          },
          orderBy: [{ lastRequeryAt: 'asc' }, { createdAt: 'asc' }],
          select,
        }),
        this.prisma.vtuWebhookInbox.findMany({
          where: {
            processedAt: null,
            attempts: { gt: 0 },
          },
          take: limit,
          orderBy: [{ attempts: 'desc' }, { updatedAt: 'asc' }],
          select: {
            providerRequestId: true,
            providerTransactionId: true,
            providerStatus: true,
            attempts: true,
            nextAttemptAt: true,
            lastError: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);
    const orders = Array.from(
      new Map(
        [...actionRequiredOrders, ...recentOrders].map((order) => [
          order.id,
          order,
        ]),
      ).values(),
    ).slice(0, limit);

    const summary = {
      ordersReviewed: orders.length,
      totalOrderAmount: new Decimal(0),
      totalCostAmount: new Decimal(0),
      totalProviderCommission: new Decimal(0),
      totalFees: new Decimal(0),
      totalMargin: new Decimal(0),
      totalDebitAmount: new Decimal(0),
      amountMismatches: 0,
      feeMismatches: 0,
      missingDebitLedger: 0,
      staleOrders: 0,
      actionRequiredOrders: 0,
      terminalWithoutReversalCredit: 0,
    };
    const providerBreakdown = new Map<
      string,
      {
        provider: string;
        count: number;
        totalAmount: Decimal;
        totalCostAmount: Decimal;
        totalProviderCommission: Decimal;
        totalFees: Decimal;
        totalMargin: Decimal;
        totalDebitAmount: Decimal;
      }
    >();
    const statusBreakdown = new Map<
      string,
      {
        status: string;
        count: number;
        totalAmount: Decimal;
        totalCostAmount: Decimal;
        totalProviderCommission: Decimal;
        totalFees: Decimal;
        totalMargin: Decimal;
        totalDebitAmount: Decimal;
      }
    >();
    const exceptions = {
      amountMismatches: [] as Array<Record<string, unknown>>,
      feeMismatches: [] as Array<Record<string, unknown>>,
      missingDebitLedger: [] as Array<Record<string, unknown>>,
      staleOrders: [] as Array<Record<string, unknown>>,
      terminalWithoutReversalCredit: [] as Array<Record<string, unknown>>,
    };

    for (const order of orders) {
      const orderAmount = new Decimal(order.amount);
      const providerCost = this.toDecimalOrZero(order.costAmount);
      const providerCommission = this.toDecimalOrZero(order.providerCommission);
      const orderFee = this.toDecimalOrZero(order.fee);
      const orderMargin = this.toDecimalOrZero(order.margin);
      const expectedDebit = orderAmount.plus(orderFee);
      const debitLedger = order.transaction.ledgerEntries.find(
        (entry) =>
          entry.source === 'VTU_PURCHASE' && entry.direction === 'DEBIT',
      );
      const reversalCredit = order.transaction.ledgerEntries.find(
        (entry) =>
          entry.source === 'VTU_REVERSAL' && entry.direction === 'CREDIT',
      );

      summary.totalOrderAmount = summary.totalOrderAmount.plus(orderAmount);
      summary.totalCostAmount = summary.totalCostAmount.plus(providerCost);
      summary.totalProviderCommission =
        summary.totalProviderCommission.plus(providerCommission);
      summary.totalFees = summary.totalFees.plus(orderFee);
      summary.totalMargin = summary.totalMargin.plus(orderMargin);
      summary.totalDebitAmount = summary.totalDebitAmount.plus(expectedDebit);
      this.addVtuBreakdown(
        providerBreakdown,
        'provider',
        order.provider,
        orderAmount,
        providerCost,
        providerCommission,
        orderFee,
        orderMargin,
        expectedDebit,
      );
      this.addVtuBreakdown(
        statusBreakdown,
        'status',
        order.status,
        orderAmount,
        providerCost,
        providerCommission,
        orderFee,
        orderMargin,
        expectedDebit,
      );

      if (!new Decimal(order.transaction.amount).equals(orderAmount)) {
        summary.amountMismatches += 1;
        exceptions.amountMismatches.push({
          ...this.toVtuReconciliationOrderReference(order),
          orderAmount: orderAmount.toString(),
          transactionAmount: order.transaction.amount.toString(),
        });
      }

      if (!new Decimal(order.transaction.fee).equals(orderFee)) {
        summary.feeMismatches += 1;
        exceptions.feeMismatches.push({
          ...this.toVtuReconciliationOrderReference(order),
          orderFee: orderFee.toString(),
          transactionFee: order.transaction.fee.toString(),
        });
      }

      if (!debitLedger) {
        summary.missingDebitLedger += 1;
        exceptions.missingDebitLedger.push({
          ...this.toVtuReconciliationOrderReference(order),
          expectedDebitAmount: expectedDebit.toString(),
        });
      } else if (!new Decimal(debitLedger.amount).equals(expectedDebit)) {
        summary.amountMismatches += 1;
        exceptions.amountMismatches.push({
          ...this.toVtuReconciliationOrderReference(order),
          expectedDebitAmount: expectedDebit.toString(),
          debitLedgerAmount: debitLedger.amount.toString(),
          ledgerEntryId: debitLedger.id,
        });
      }

      const actionRequired =
        STALE_VTU_STATUSES.includes(order.status) &&
        order.transaction.status === 'PENDING' &&
        order.requeryAttempts >= VTU_REQUERY_MAX_ATTEMPTS;
      if (actionRequired) summary.actionRequiredOrders += 1;

      if (
        actionRequired ||
        (STALE_VTU_STATUSES.includes(order.status) && order.createdAt < cutoff)
      ) {
        summary.staleOrders += 1;
        exceptions.staleOrders.push({
          ...this.toVtuReconciliationOrderReference(order),
          providerStatus: order.providerStatus,
          targetMasked: order.targetMasked,
          requeryAttempts: order.requeryAttempts,
          lastRequeryAt: order.lastRequeryAt,
          nextRequeryAt: order.nextRequeryAt,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        });
      }

      if (['FAILED', 'REVERSED'].includes(order.status) && !reversalCredit) {
        summary.terminalWithoutReversalCredit += 1;
        exceptions.terminalWithoutReversalCredit.push({
          ...this.toVtuReconciliationOrderReference(order),
          expectedReversalAmount: expectedDebit.toString(),
          failedAt: order.failedAt,
        });
      }
    }

    return {
      generatedAt,
      olderThanMinutes,
      limit,
      cutoff,
      orders: orders.map((order) => {
        const actionRequired =
          STALE_VTU_STATUSES.includes(order.status) &&
          order.transaction.status === 'PENDING' &&
          order.requeryAttempts >= VTU_REQUERY_MAX_ATTEMPTS;
        return {
          ...this.toVtuReconciliationOrderReference(order),
          costAmount: this.toDecimalOrZero(order.costAmount).toString(),
          providerCommission: this.toDecimalOrZero(
            order.providerCommission,
          ).toString(),
          margin: this.toDecimalOrZero(order.margin).toString(),
          providerStatus: order.providerStatus,
          targetMasked: order.targetMasked,
          requeryAttempts: order.requeryAttempts,
          lastRequeryAt: order.lastRequeryAt,
          nextRequeryAt: order.nextRequeryAt,
          actionRequired,
          actionRequiredCode: actionRequired ? VTU_ACTION_REQUIRED_CODE : null,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        };
      }),
      callbackFailures,
      summary: this.stringifyVtuReconciliationSummary(summary),
      providerBreakdown: this.stringifyVtuBreakdown(providerBreakdown),
      statusBreakdown: this.stringifyVtuBreakdown(statusBreakdown),
      breakdowns: {
        providers: this.stringifyVtuBreakdown(providerBreakdown),
        statuses: this.stringifyVtuBreakdown(statusBreakdown),
      },
      exceptions: {
        amountMismatches: exceptions.amountMismatches,
        feeMismatches: exceptions.feeMismatches,
        missingDebits: exceptions.missingDebitLedger,
        missingReversals: exceptions.terminalWithoutReversalCredit,
        staleOrders: exceptions.staleOrders,
        missingDebitLedger: exceptions.missingDebitLedger,
        terminalWithoutReversalCredit: exceptions.terminalWithoutReversalCredit,
      },
    };
  }

  async requeryVtuOrder(
    reference: string,
    dto: AdminActionReasonDto,
    adminId: string,
  ) {
    this.assertReason(dto.reason);

    const before = await this.vtuService.findOrderForAdmin(reference);
    if (!before) {
      throw new NotFoundException('VTU order not found');
    }

    let requeryResult: Awaited<ReturnType<VtuService['requeryOrder']>> | null =
      null;
    let requeryError: string | null = null;

    try {
      requeryResult = await this.vtuService.requeryOrder(before.id, true);
    } catch (error) {
      requeryError = error instanceof Error ? error.message : 'Unknown error';
    }

    const after = await this.vtuService.findOrderForAdmin(before.id);

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'VTU_ORDER_REQUERY',
        targetType: 'VtuOrder',
        targetId: before.id,
        reference,
        reason: dto.reason,
        before: this.toVtuOrderAuditSnapshot(before),
        after: this.toVtuOrderAuditSnapshot(after),
        metadata: {
          requestedReference: reference,
          transactionReference: before.transaction.reference,
          provider: before.provider,
          providerRequestId: before.providerRequestId,
          providerTransactionId: before.providerTransactionId,
          requeryResult: requeryResult ?? {
            processed: false,
            error: requeryError,
          },
        },
      },
    });

    if (requeryError) {
      this.logger.warn(
        {
          adminId,
          reference,
          orderId: before.id,
          error: requeryError,
        },
        'Admin manual VTU order requery failed',
      );
      throw new BadRequestException('VTU order requery failed');
    }

    this.logger.info(
      {
        adminId,
        reference,
        orderId: before.id,
        status: after?.status,
      },
      'Admin manually requeried VTU order',
    );

    return {
      orderId: before.id,
      reference,
      result: requeryResult,
      order: after,
    };
  }

  async listVtuPricingRules(query: {
    limit?: number;
    countryCode?: string;
    serviceType?: string;
    provider?: string;
    scope?: string;
    isActive?: boolean;
  }) {
    const where: Prisma.VtuPricingRuleWhereInput = {};
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.serviceType)
      where.serviceType = query.serviceType as TransactionType;
    if (query.provider) where.provider = query.provider;
    if (query.scope) where.scope = query.scope as VtuOrderScope;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    return this.prisma.vtuPricingRule.findMany({
      take: query.limit ?? 50,
      where,
      orderBy: [
        { isActive: 'desc' },
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async createVtuPricingRule(
    dto: AdminCreateVtuPricingRuleDto,
    adminId: string,
  ) {
    this.assertReason(dto.reason);
    this.assertVtuPricingRuleAmounts(dto);

    const { reason, ...ruleInput } = dto;
    const created = await this.prisma.$transaction(async (tx) => {
      const rule = await tx.vtuPricingRule.create({
        data: this.buildVtuPricingRuleData(ruleInput),
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'VTU_PRICING_RULE_CREATE',
          targetType: 'VtuPricingRule',
          targetId: rule.id,
          reason,
          after: this.toVtuPricingRuleAuditSnapshot(rule),
          metadata: {
            countryCode: rule.countryCode,
            serviceType: rule.serviceType,
            provider: rule.provider,
            scope: rule.scope,
            priority: rule.priority,
          },
        },
      });

      return rule;
    });

    this.logger.info(
      { adminId, ruleId: created.id },
      'Admin created VTU pricing rule',
    );

    return created;
  }

  async updateVtuPricingRule(
    ruleId: string,
    dto: AdminUpdateVtuPricingRuleDto,
    adminId: string,
  ) {
    this.assertReason(dto.reason);
    this.assertVtuPricingRuleAmounts(dto);

    const existing = await this.prisma.vtuPricingRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) {
      throw new NotFoundException('VTU pricing rule not found');
    }

    const { reason, ...ruleInput } = dto;
    const updated = await this.prisma.$transaction(async (tx) => {
      const rule = await tx.vtuPricingRule.update({
        where: { id: ruleId },
        data: this.buildVtuPricingRuleData(ruleInput),
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'VTU_PRICING_RULE_UPDATE',
          targetType: 'VtuPricingRule',
          targetId: ruleId,
          reason,
          before: this.toVtuPricingRuleAuditSnapshot(existing),
          after: this.toVtuPricingRuleAuditSnapshot(rule),
          metadata: {
            changedFields: Object.keys(ruleInput),
          },
        },
      });

      return rule;
    });

    this.logger.info({ adminId, ruleId }, 'Admin updated VTU pricing rule');

    return updated;
  }

  async deactivateVtuPricingRule(
    ruleId: string,
    dto: AdminActionReasonDto,
    adminId: string,
  ) {
    this.assertReason(dto.reason);

    const existing = await this.prisma.vtuPricingRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) {
      throw new NotFoundException('VTU pricing rule not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const rule = await tx.vtuPricingRule.update({
        where: { id: ruleId },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'VTU_PRICING_RULE_DEACTIVATE',
          targetType: 'VtuPricingRule',
          targetId: ruleId,
          reason: dto.reason,
          before: this.toVtuPricingRuleAuditSnapshot(existing),
          after: this.toVtuPricingRuleAuditSnapshot(rule),
        },
      });

      return rule;
    });

    this.logger.info({ adminId, ruleId }, 'Admin deactivated VTU pricing rule');

    return updated;
  }

  listInternalTransferLimitPolicies(
    query: InternalTransferLimitPolicyQueryDto,
  ) {
    return this.prisma.internalTransferLimitPolicy.findMany({
      where: {
        currency: query.currency,
        kycTier: query.kycTier,
        enabled: query.enabled,
      },
      orderBy: [{ currency: 'asc' }, { kycTier: 'asc' }, { version: 'desc' }],
    });
  }

  async requestInternalTransferLimitPolicy(
    dto: CreateInternalTransferLimitPolicyDto,
    adminId: string,
    auditContext?: RequestAuditContext,
  ) {
    this.assertReason(dto.reason);
    const perTransaction = new Decimal(dto.perTransaction);
    const daily = new Decimal(dto.daily);
    const monthly = new Decimal(dto.monthly);
    this.assertOrderedTransferPolicyLimits(perTransaction, daily, monthly);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const latest = await tx.internalTransferLimitPolicy.findFirst({
            where: { currency: dto.currency, kycTier: dto.kycTier },
            orderBy: { version: 'desc' },
            select: { version: true },
          });

          const policy = await tx.internalTransferLimitPolicy.create({
            data: {
              currency: dto.currency,
              kycTier: dto.kycTier,
              perTransaction,
              daily,
              monthly,
              enabled: false,
              version: (latest?.version ?? 0) + 1,
              requestedById: adminId,
              reason: dto.reason.trim(),
            },
          });

          await tx.auditLog.create({
            data: {
              adminId,
              action: 'internal_transfer_limit_policy_requested',
              targetType: 'InternalTransferLimitPolicy',
              targetId: policy.id,
              reason: dto.reason.trim(),
              after: this.toInternalTransferLimitPolicyAuditSnapshot(policy),
              metadata: this.toRequestAuditMetadata(auditContext),
            },
          });

          return policy;
        },
        { maxWait: 2_000, timeout: 5_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A policy version was created concurrently; retry with a new idempotency key',
        );
      }
      throw error;
    }
  }

  async approveInternalTransferLimitPolicy(
    policyId: string,
    dto: ApproveInternalTransferLimitPolicyDto,
    adminId: string,
    auditContext?: RequestAuditContext,
  ) {
    this.assertReason(dto.reason);

    return this.prisma.$transaction(
      async (tx) => {
        const policy = await tx.internalTransferLimitPolicy.findUnique({
          where: { id: policyId },
        });

        if (!policy) {
          throw new NotFoundException(
            'Internal transfer limit policy not found',
          );
        }
        if (policy.requestedById === adminId) {
          throw new ForbiddenException(
            'A second administrator must approve this policy',
          );
        }
        if (policy.enabled || policy.approvedById) {
          throw new ConflictException('Policy has already been decided');
        }

        const now = new Date();
        const activePolicies = await tx.internalTransferLimitPolicy.findMany({
          where: {
            currency: policy.currency,
            kycTier: policy.kycTier,
            enabled: true,
          },
          select: { id: true },
        });

        if (activePolicies.length > 0) {
          await tx.internalTransferLimitPolicy.updateMany({
            where: { id: { in: activePolicies.map(({ id }) => id) } },
            data: { enabled: false, disabledAt: now },
          });
        }

        const claimed = await tx.internalTransferLimitPolicy.updateMany({
          where: {
            id: policyId,
            enabled: false,
            approvedById: null,
          },
          data: {
            approvedById: adminId,
            approvalReason: dto.reason.trim(),
            approvedAt: now,
            effectiveFrom: now,
          },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('Policy has already been decided');
        }

        const activated = await tx.internalTransferLimitPolicy.update({
          where: { id: policyId },
          data: { enabled: true, disabledAt: null },
        });

        for (const disabled of activePolicies) {
          await tx.auditLog.create({
            data: {
              adminId,
              action: 'internal_transfer_limit_policy_disabled',
              targetType: 'InternalTransferLimitPolicy',
              targetId: disabled.id,
              reason: `Superseded by ${policyId}: ${dto.reason.trim()}`,
              before: { enabled: true },
              after: { enabled: false, disabledAt: now.toISOString() },
              metadata: this.toRequestAuditMetadata(auditContext),
            },
          });
        }

        await tx.auditLog.create({
          data: {
            adminId,
            action: 'internal_transfer_limit_policy_approved',
            targetType: 'InternalTransferLimitPolicy',
            targetId: policyId,
            reason: dto.reason.trim(),
            before: this.toInternalTransferLimitPolicyAuditSnapshot(policy),
            after: this.toInternalTransferLimitPolicyAuditSnapshot(activated),
            metadata: this.toRequestAuditMetadata(auditContext),
          },
        });
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'internal_transfer_limit_policy_activated',
            targetType: 'InternalTransferLimitPolicy',
            targetId: policyId,
            reason: dto.reason.trim(),
            after: this.toInternalTransferLimitPolicyAuditSnapshot(activated),
            metadata: this.toRequestAuditMetadata(auditContext),
          },
        });

        return activated;
      },
      { maxWait: 2_000, timeout: 5_000 },
    );
  }

  async disableInternalTransferLimitPolicy(
    policyId: string,
    dto: AdminActionReasonDto,
    adminId: string,
    auditContext?: RequestAuditContext,
  ) {
    this.assertReason(dto.reason);

    return this.prisma.$transaction(
      async (tx) => {
        const policy = await tx.internalTransferLimitPolicy.findUnique({
          where: { id: policyId },
        });
        if (!policy) {
          throw new NotFoundException(
            'Internal transfer limit policy not found',
          );
        }
        if (!policy.enabled) {
          throw new ConflictException('Policy is already disabled');
        }

        const disabled = await tx.internalTransferLimitPolicy.update({
          where: { id: policyId },
          data: { enabled: false, disabledAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            adminId,
            action: 'internal_transfer_limit_policy_disabled',
            targetType: 'InternalTransferLimitPolicy',
            targetId: policyId,
            reason: dto.reason.trim(),
            before: this.toInternalTransferLimitPolicyAuditSnapshot(policy),
            after: this.toInternalTransferLimitPolicyAuditSnapshot(disabled),
            metadata: this.toRequestAuditMetadata(auditContext),
          },
        });
        return disabled;
      },
      { maxWait: 2_000, timeout: 5_000 },
    );
  }

  async getAuditLogs(query: number | AdminAuditLogsQueryDto = 50) {
    const limit = typeof query === 'number' ? query : (query.limit ?? 50);
    const filters =
      typeof query === 'number'
        ? {}
        : {
            q: query.q?.trim(),
            action: query.action?.trim(),
            targetType: query.targetType?.trim(),
            targetId: query.targetId?.trim(),
            adminId: query.adminId?.trim(),
            from: query.from,
            to: query.to,
            reference: query.reference?.trim(),
            requestId: query.requestId?.trim(),
            userId: query.userId,
            reversalState: query.reversalState,
          };

    const whereClauses: Prisma.AuditLogWhereInput[] = [];

    if (filters.action) {
      whereClauses.push({ action: filters.action });
    }

    if (filters.targetType) {
      whereClauses.push({ targetType: filters.targetType });
    }

    if (filters.targetId) {
      whereClauses.push({ targetId: filters.targetId });
    }

    if (filters.adminId) {
      whereClauses.push({ adminId: filters.adminId });
    }

    if (filters.from || filters.to) {
      whereClauses.push({
        createdAt: {
          gte: filters.from ? new Date(filters.from) : undefined,
          lte: filters.to ? new Date(filters.to) : undefined,
        },
      });
    }

    if (filters.reference) {
      whereClauses.push({ reference: filters.reference });
    }

    if (filters.requestId) {
      whereClauses.push({
        metadata: { path: ['requestId'], equals: filters.requestId },
      });
    }

    if (filters.userId) {
      whereClauses.push({
        OR: [
          { adminId: filters.userId },
          { targetId: filters.userId },
          {
            metadata: { path: ['actorUserId'], equals: filters.userId },
          },
          {
            metadata: { path: ['senderUserId'], equals: filters.userId },
          },
          {
            metadata: { path: ['recipientUserId'], equals: filters.userId },
          },
        ],
      });
    }

    if (filters.reversalState) {
      whereClauses.push({
        targetType: 'InternalTransferReversal',
        after: { path: ['status'], equals: filters.reversalState },
      });
    }

    if (filters.q) {
      whereClauses.push({
        OR: [
          { action: { contains: filters.q, mode: 'insensitive' } },
          { targetType: { contains: filters.q, mode: 'insensitive' } },
          { targetId: { contains: filters.q, mode: 'insensitive' } },
          { reference: { contains: filters.q, mode: 'insensitive' } },
          { reason: { contains: filters.q, mode: 'insensitive' } },
          {
            admin: {
              is: {
                email: { contains: filters.q, mode: 'insensitive' },
              },
            },
          },
          {
            admin: {
              is: {
                fullName: { contains: filters.q, mode: 'insensitive' },
              },
            },
          },
        ],
      });
    }

    const where = whereClauses.length > 0 ? { AND: whereClauses } : undefined;

    const logs = await this.prisma.auditLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        adminId: true,
        admin: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
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

  async getOpsSummary(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }

    const receiptStatuses = {
      submitted: 'SUBMITTED',
      underReview: 'UNDER_REVIEW',
      approved: 'APPROVED',
      credited: 'CREDITED',
      rejected: 'REJECTED',
      needsMoreInfo: 'NEEDS_MORE_INFO',
    } as const satisfies Record<string, ExchangeReceiptStatus>;
    const payoutStatuses = {
      pendingApproval: 'PENDING_APPROVAL',
      approved: 'APPROVED',
      processing: 'PROCESSING',
      sent: 'SENT',
      failed: 'FAILED',
      reversed: 'REVERSED',
    } as const satisfies Record<string, ExchangePayoutStatus>;
    const serviceOrder: TransactionType[] = [
      'AIRTIME',
      'DATA',
      'CABLE',
      'ELECTRICITY',
    ];
    const platformServiceTrendStart = new Date();
    platformServiceTrendStart.setUTCHours(0, 0, 0, 0);
    platformServiceTrendStart.setUTCDate(
      platformServiceTrendStart.getUTCDate() -
        (PLATFORM_SERVICE_TREND_DAYS - 1),
    );

    const [
      stats,
      suspendedUsers,
      verifiedUsers,
      walletExposure,
      receiptBuckets,
      payoutBuckets,
      platformServiceBuckets,
      platformServiceTrendRows,
      vtuBuckets,
      openVtuOrders,
      recentTransactions,
      recentAuditLogs,
    ] = await Promise.all([
      this.getStats(),
      this.prisma.user.count({ where: { isSuspended: true } }),
      this.prisma.user.count({ where: { kycStatus: 'VERIFIED' } }),
      this.prisma.wallet.groupBy({
        by: ['currency'],
        _count: { _all: true },
        _sum: { balance: true },
      }),
      this.prisma.exchangeReceipt.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: {
          amount: true,
          expectedCreditAmount: true,
        },
      }),
      this.prisma.exchangePayout.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: {
          sourceAmount: true,
          destinationAmount: true,
          fee: true,
        },
      }),
      this.prisma.transaction.groupBy({
        by: ['type', 'currency'],
        where: { status: 'SUCCESS' },
        _count: { _all: true },
        _sum: {
          amount: true,
          fee: true,
        },
        _max: {
          createdAt: true,
        },
      }),
      this.prisma.transaction.findMany({
        where: {
          status: 'SUCCESS',
          type: { in: USER_SERVICE_ORDER },
          createdAt: {
            gte: platformServiceTrendStart,
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          type: true,
          currency: true,
          amount: true,
          fee: true,
          createdAt: true,
        },
      }),
      this.prisma.vtuOrder.groupBy({
        by: ['serviceType'],
        _count: { _all: true },
        _sum: {
          amount: true,
          fee: true,
          costAmount: true,
          margin: true,
        },
      }),
      this.prisma.vtuOrder.count({
        where: {
          status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] },
        },
      }),
      this.prisma.transaction.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          type: true,
          amount: true,
          currency: true,
          status: true,
          fee: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.auditLog.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          reference: true,
          reason: true,
          createdAt: true,
          admin: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
      }),
    ]);

    const walletExposureByCurrency = walletExposure
      .map((entry) => ({
        currency: entry.currency,
        walletCount: entry._count._all,
        balance: this.toDecimalOrZero(entry._sum.balance).toFixed(2),
      }))
      .sort((left, right) => {
        const order: Record<string, number> = { NGN: 0, GHS: 1 };
        return (order[left.currency] ?? 99) - (order[right.currency] ?? 99);
      });

    const totalWalletExposure = walletExposureByCurrency
      .reduce(
        (total, entry) => total.plus(new Decimal(entry.balance)),
        new Decimal(0),
      )
      .toFixed(2);

    const receiptStatusCounts = this.groupStatusCounts(
      receiptStatuses,
      receiptBuckets,
    );
    const payoutStatusCounts = this.groupStatusCounts(
      payoutStatuses,
      payoutBuckets,
    );

    const receiptTotals = receiptBuckets.reduce(
      (totals, entry) => ({
        sourceAmount: totals.sourceAmount.plus(
          this.toDecimalOrZero(entry._sum.amount),
        ),
        expectedCreditAmount: totals.expectedCreditAmount.plus(
          this.toDecimalOrZero(entry._sum.expectedCreditAmount),
        ),
      }),
      {
        sourceAmount: new Decimal(0),
        expectedCreditAmount: new Decimal(0),
      },
    );

    const payoutTotals = payoutBuckets.reduce(
      (totals, entry) => ({
        sourceAmount: totals.sourceAmount.plus(
          this.toDecimalOrZero(entry._sum.sourceAmount),
        ),
        destinationAmount: totals.destinationAmount.plus(
          this.toDecimalOrZero(entry._sum.destinationAmount),
        ),
        fee: totals.fee.plus(this.toDecimalOrZero(entry._sum.fee)),
      }),
      {
        sourceAmount: new Decimal(0),
        destinationAmount: new Decimal(0),
        fee: new Decimal(0),
      },
    );

    const platformServiceBreakdown = platformServiceBuckets
      .map((entry) => ({
        serviceType: entry.type,
        currency: entry.currency,
        transactionCount: entry._count._all,
        amount: this.toDecimalOrZero(entry._sum.amount).toFixed(2),
        fee: this.toDecimalOrZero(entry._sum.fee).toFixed(2),
        lastActivityAt: entry._max.createdAt?.toISOString() ?? null,
      }))
      .sort((left, right) => {
        const typeDiff =
          USER_SERVICE_ORDER.indexOf(left.serviceType) -
          USER_SERVICE_ORDER.indexOf(right.serviceType);
        if (typeDiff !== 0) {
          return typeDiff;
        }

        const currencyOrder: Record<string, number> = { NGN: 0, GHS: 1 };
        return (
          (currencyOrder[left.currency] ?? 99) -
          (currencyOrder[right.currency] ?? 99)
        );
      });

    const totalPlatformServiceAmount = platformServiceBuckets
      .reduce(
        (total, entry) => total.plus(this.toDecimalOrZero(entry._sum.amount)),
        new Decimal(0),
      )
      .toFixed(2);
    const totalPlatformServiceFees = platformServiceBuckets
      .reduce(
        (total, entry) => total.plus(this.toDecimalOrZero(entry._sum.fee)),
        new Decimal(0),
      )
      .toFixed(2);
    const totalPlatformServiceTransactions = platformServiceBuckets.reduce(
      (total, entry) => total + entry._count._all,
      0,
    );
    const platformServiceTrend = this.buildPlatformServiceTrend(
      platformServiceTrendRows,
      platformServiceTrendStart,
    );

    const vtuServiceBreakdown = vtuBuckets
      .map((entry) => ({
        serviceType: entry.serviceType,
        orderCount: entry._count._all,
        amount: this.toDecimalOrZero(entry._sum.amount).toFixed(2),
        fee: this.toDecimalOrZero(entry._sum.fee).toFixed(2),
        costAmount: this.toDecimalOrZero(entry._sum.costAmount).toFixed(2),
        margin: this.toDecimalOrZero(entry._sum.margin).toFixed(2),
      }))
      .sort(
        (left, right) =>
          serviceOrder.indexOf(left.serviceType) -
          serviceOrder.indexOf(right.serviceType),
      );

    const totalVtuAmount = vtuBuckets
      .reduce(
        (total, entry) => total.plus(this.toDecimalOrZero(entry._sum.amount)),
        new Decimal(0),
      )
      .toFixed(2);
    const totalVtuFees = vtuBuckets
      .reduce(
        (total, entry) => total.plus(this.toDecimalOrZero(entry._sum.fee)),
        new Decimal(0),
      )
      .toFixed(2);
    const totalVtuCostAmount = vtuBuckets
      .reduce(
        (total, entry) =>
          total.plus(this.toDecimalOrZero(entry._sum.costAmount)),
        new Decimal(0),
      )
      .toFixed(2);
    const totalVtuMargin = vtuBuckets
      .reduce(
        (total, entry) => total.plus(this.toDecimalOrZero(entry._sum.margin)),
        new Decimal(0),
      )
      .toFixed(2);

    const activeBankingProvider = this.configService.get<string>(
      'BANKING_PROVIDER_PRIMARY',
      'paystack',
    );
    const settlementAccountNumber =
      activeBankingProvider === 'paystack'
        ? ''
        : this.configService
            .get<string>('MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER', '')
            ?.trim() || '';

    return {
      generatedAt: new Date(),
      stats: {
        ...stats,
        suspendedUsers,
        verifiedUsers,
      },
      treasury: {
        settlementAccount: {
          provider: activeBankingProvider.toUpperCase(),
          configured:
            activeBankingProvider === 'paystack'
              ? Boolean(this.configService.get<string>('PAYSTACK_SECRET_KEY'))
              : settlementAccountNumber.length > 0,
          accountNumberMasked: settlementAccountNumber
            ? maskAccountNumber(settlementAccountNumber)
            : null,
          note:
            activeBankingProvider === 'paystack'
              ? 'Paystack withdrawals use the merchant balance. Check provider readiness and liquidity before settlement.'
              : settlementAccountNumber
                ? 'Exchange deposits settle to the configured Monnify collection account.'
                : 'Configure MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER to lock exchange deposits to one settlement account.',
        },
        walletExposure: walletExposureByCurrency,
        totalWalletExposure,
      },
      exchange: {
        receipts: {
          ...receiptStatusCounts,
          totalSourceAmount: receiptTotals.sourceAmount.toFixed(2),
          totalExpectedCreditAmount:
            receiptTotals.expectedCreditAmount.toFixed(2),
        },
        payouts: {
          ...payoutStatusCounts,
          totalSourceAmount: payoutTotals.sourceAmount.toFixed(2),
          totalDestinationAmount: payoutTotals.destinationAmount.toFixed(2),
          totalFees: payoutTotals.fee.toFixed(2),
        },
      },
      platformServices: {
        totalTransactions: totalPlatformServiceTransactions,
        totalAmount: totalPlatformServiceAmount,
        totalFees: totalPlatformServiceFees,
        breakdown: platformServiceBreakdown,
        trend: platformServiceTrend,
      },
      vtu: {
        totalOrders: vtuBuckets.reduce(
          (total, entry) => total + entry._count._all,
          0,
        ),
        openOrders: openVtuOrders,
        totalAmount: totalVtuAmount,
        totalFees: totalVtuFees,
        totalCostAmount: totalVtuCostAmount,
        totalMargin: totalVtuMargin,
        serviceBreakdown: vtuServiceBreakdown,
      },
      activity: {
        recentTransactions: recentTransactions.map((transaction) => ({
          ...transaction,
          amount: new Decimal(transaction.amount).toFixed(2),
          fee: new Decimal(transaction.fee).toFixed(2),
        })),
        recentAuditLogs,
      },
    };
  }

  private async verifyProviderTransfer(latestAttempt: {
    provider: string;
    providerReference: string;
  }) {
    if (latestAttempt.provider !== 'MONNIFY') {
      throw new BadRequestException(
        'Provider transfer verification is not supported for this provider',
      );
    }

    const transfer = await this.bankingService.getTransferStatus(
      latestAttempt.providerReference,
    );

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

  private toRefreshTokenAuditSnapshot(session: {
    id: string;
    userId: string;
    deviceId: string;
    deviceName: string | null;
    userAgent: string | null;
    ipAddress: string | null;
    lastUsedAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  }): Prisma.InputJsonValue {
    return {
      id: session.id,
      userId: session.userId,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
    };
  }

  private groupStatusCounts<TStatusMap extends Record<string, string>>(
    statuses: TStatusMap,
    rows: Array<{ status: string; _count: { _all: number } }>,
  ) {
    const counts: Record<string, number> = {};

    for (const [key, status] of Object.entries(statuses)) {
      counts[key] = rows.find((row) => row.status === status)?._count._all ?? 0;
    }

    return counts as Record<keyof TStatusMap, number>;
  }

  private assertVtuPricingRuleAmounts(input: {
    fixedMargin?: string;
    percentMargin?: string;
    minAmount?: string;
    maxAmount?: string;
  }) {
    const fixedMargin =
      input.fixedMargin === undefined
        ? new Decimal(0)
        : new Decimal(input.fixedMargin);
    const percentMargin =
      input.percentMargin === undefined
        ? new Decimal(0)
        : new Decimal(input.percentMargin);

    if (fixedMargin.lessThan(0) || percentMargin.lessThan(0)) {
      throw new BadRequestException('VTU margins cannot be negative');
    }

    if (percentMargin.greaterThan(100)) {
      throw new BadRequestException('VTU percent margin cannot exceed 100');
    }

    if (input.minAmount && input.maxAmount) {
      const minAmount = new Decimal(input.minAmount);
      const maxAmount = new Decimal(input.maxAmount);
      if (minAmount.greaterThan(maxAmount)) {
        throw new BadRequestException('minAmount cannot exceed maxAmount');
      }
    }
  }

  private buildVtuPricingRuleData(input: {
    countryCode?: string;
    serviceType?: string;
    provider?: string;
    scope?: string;
    fixedMargin?: string;
    percentMargin?: string;
    minAmount?: string;
    maxAmount?: string;
    priority?: number;
    isActive?: boolean;
  }) {
    return {
      countryCode: input.countryCode,
      serviceType: input.serviceType as TransactionType | undefined,
      provider: input.provider,
      scope: input.scope as VtuOrderScope | undefined,
      fixedMargin:
        input.fixedMargin === undefined
          ? undefined
          : new Decimal(input.fixedMargin),
      percentMargin:
        input.percentMargin === undefined
          ? undefined
          : new Decimal(input.percentMargin),
      minAmount:
        input.minAmount === undefined
          ? undefined
          : new Decimal(input.minAmount),
      maxAmount:
        input.maxAmount === undefined
          ? undefined
          : new Decimal(input.maxAmount),
      priority: input.priority,
      isActive: input.isActive,
    };
  }

  private toDecimalOrZero(value: Decimal | null | undefined) {
    return value === null || value === undefined
      ? new Decimal(0)
      : new Decimal(value);
  }

  private buildPlatformServiceTrend(
    rows: Array<{
      type: TransactionType;
      currency: WalletCurrency;
      amount: Decimal;
      fee: Decimal;
      createdAt: Date;
    }>,
    windowStart: Date,
  ) {
    const currencyOrder: Record<WalletCurrency, number> = {
      NGN: 0,
      GHS: 1,
    };

    const trendBuckets = Array.from(
      { length: PLATFORM_SERVICE_TREND_DAYS },
      (_, offset) => {
        const date = new Date(windowStart);
        date.setUTCDate(date.getUTCDate() + offset);

        return {
          date,
          transactionCount: 0,
          serviceCounts: new Map<TransactionType, number>(),
          currencyBreakdown: new Map<
            WalletCurrency,
            {
              transactionCount: number;
              amount: Decimal;
              fee: Decimal;
            }
          >(),
        };
      },
    );

    const trendBucketByDate = new Map(
      trendBuckets.map((bucket) => [
        bucket.date.toISOString().slice(0, 10),
        bucket,
      ]),
    );

    for (const row of rows) {
      const bucket = trendBucketByDate.get(
        row.createdAt.toISOString().slice(0, 10),
      );

      if (!bucket) {
        continue;
      }

      bucket.transactionCount += 1;
      bucket.serviceCounts.set(
        row.type,
        (bucket.serviceCounts.get(row.type) ?? 0) + 1,
      );

      const currencyBucket = bucket.currencyBreakdown.get(row.currency) ?? {
        transactionCount: 0,
        amount: new Decimal(0),
        fee: new Decimal(0),
      };

      currencyBucket.transactionCount += 1;
      currencyBucket.amount = currencyBucket.amount.plus(
        this.toDecimalOrZero(row.amount),
      );
      currencyBucket.fee = currencyBucket.fee.plus(
        this.toDecimalOrZero(row.fee),
      );
      bucket.currencyBreakdown.set(row.currency, currencyBucket);
    }

    return trendBuckets.map((bucket) => {
      const topServiceEntry = Array.from(bucket.serviceCounts.entries()).sort(
        (left, right) => {
          const countDiff = right[1] - left[1];
          if (countDiff !== 0) {
            return countDiff;
          }

          return (
            USER_SERVICE_ORDER.indexOf(left[0]) -
            USER_SERVICE_ORDER.indexOf(right[0])
          );
        },
      )[0];

      return {
        date: bucket.date.toISOString(),
        transactionCount: bucket.transactionCount,
        topServiceType: topServiceEntry?.[0] ?? null,
        topServiceCount: topServiceEntry?.[1] ?? 0,
        currencyBreakdown: Array.from(bucket.currencyBreakdown.entries())
          .sort(
            (left, right) =>
              (currencyOrder[left[0]] ?? 99) - (currencyOrder[right[0]] ?? 99),
          )
          .map(([currency, values]) => ({
            currency,
            transactionCount: values.transactionCount,
            amount: values.amount.toFixed(2),
            fee: values.fee.toFixed(2),
          })),
      };
    });
  }

  private addVtuBreakdown(
    breakdown: Map<
      string,
      {
        provider?: string;
        status?: string;
        count: number;
        totalAmount: Decimal;
        totalCostAmount: Decimal;
        totalProviderCommission: Decimal;
        totalFees: Decimal;
        totalMargin: Decimal;
        totalDebitAmount: Decimal;
      }
    >,
    label: 'provider' | 'status',
    key: string,
    amount: Decimal,
    costAmount: Decimal,
    providerCommission: Decimal,
    fee: Decimal,
    margin: Decimal,
    debitAmount: Decimal,
  ) {
    const existing = breakdown.get(key) ?? {
      [label]: key,
      count: 0,
      totalAmount: new Decimal(0),
      totalCostAmount: new Decimal(0),
      totalProviderCommission: new Decimal(0),
      totalFees: new Decimal(0),
      totalMargin: new Decimal(0),
      totalDebitAmount: new Decimal(0),
    };

    existing.count += 1;
    existing.totalAmount = existing.totalAmount.plus(amount);
    existing.totalCostAmount = existing.totalCostAmount.plus(costAmount);
    existing.totalProviderCommission =
      existing.totalProviderCommission.plus(providerCommission);
    existing.totalFees = existing.totalFees.plus(fee);
    existing.totalMargin = existing.totalMargin.plus(margin);
    existing.totalDebitAmount = existing.totalDebitAmount.plus(debitAmount);
    breakdown.set(key, existing);
  }

  private stringifyVtuBreakdown(
    breakdown: Map<
      string,
      {
        provider?: string;
        status?: string;
        count: number;
        totalAmount: Decimal;
        totalCostAmount: Decimal;
        totalProviderCommission: Decimal;
        totalFees: Decimal;
        totalMargin: Decimal;
        totalDebitAmount: Decimal;
      }
    >,
  ) {
    return Array.from(breakdown.values()).map((item) => ({
      ...item,
      currency: 'NGN',
      amount: item.totalAmount.toString(),
      costAmount: item.totalCostAmount.toString(),
      providerCommission: item.totalProviderCommission.toString(),
      fees: item.totalFees.toString(),
      margin: item.totalMargin.toString(),
      totalAmount: item.totalAmount.toString(),
      totalCostAmount: item.totalCostAmount.toString(),
      totalProviderCommission: item.totalProviderCommission.toString(),
      totalFees: item.totalFees.toString(),
      totalMargin: item.totalMargin.toString(),
      totalDebitAmount: item.totalDebitAmount.toString(),
    }));
  }

  private stringifyVtuReconciliationSummary(summary: {
    ordersReviewed: number;
    totalOrderAmount: Decimal;
    totalCostAmount: Decimal;
    totalProviderCommission: Decimal;
    totalFees: Decimal;
    totalMargin: Decimal;
    totalDebitAmount: Decimal;
    amountMismatches: number;
    feeMismatches: number;
    missingDebitLedger: number;
    staleOrders: number;
    actionRequiredOrders: number;
    terminalWithoutReversalCredit: number;
  }) {
    return {
      ...summary,
      totalOrders: summary.ordersReviewed,
      totalAmount: summary.totalOrderAmount.toString(),
      totalCostAmount: summary.totalCostAmount.toString(),
      totalProviderCommission: summary.totalProviderCommission.toString(),
      totalMargin: summary.totalMargin.toString(),
      missingDebits: summary.missingDebitLedger,
      missingReversals: summary.terminalWithoutReversalCredit,
      highRiskExceptions:
        summary.amountMismatches +
        summary.missingDebitLedger +
        summary.terminalWithoutReversalCredit,
      currency: 'NGN',
      totalOrderAmount: summary.totalOrderAmount.toString(),
      totalFees: summary.totalFees.toString(),
      totalDebitAmount: summary.totalDebitAmount.toString(),
    };
  }

  private toVtuReconciliationOrderReference(order: {
    id: string;
    provider: string;
    providerRequestId: string;
    providerTransactionId: string | null;
    status: string;
    requeryAttempts?: number;
    serviceType: string;
    amount: Decimal;
    fee: Decimal | null;
    currency: string;
    transaction: {
      id: string;
      reference: string;
      status: string;
      amount: Decimal;
      fee: Decimal;
      currency: string;
    };
  }) {
    return {
      orderId: order.id,
      provider: order.provider,
      providerRequestId: order.providerRequestId,
      providerTransactionId: order.providerTransactionId,
      status: order.status,
      serviceType: order.serviceType,
      amount: order.amount.toString(),
      fee: this.toDecimalOrZero(order.fee).toString(),
      currency: order.currency,
      transactionId: order.transaction.id,
      transactionReference: order.transaction.reference,
      transactionStatus: order.transaction.status,
      transactionAmount: order.transaction.amount.toString(),
      transactionFee: order.transaction.fee.toString(),
      transactionCurrency: order.transaction.currency,
      requeryAttempts: order.requeryAttempts,
      actionRequired:
        STALE_VTU_STATUSES.includes(order.status as VtuOrderStatus) &&
        order.transaction.status === 'PENDING' &&
        (order.requeryAttempts ?? 0) >= VTU_REQUERY_MAX_ATTEMPTS,
    };
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

  private sanitizeTransactionDrilldown<T extends { metadata?: unknown }>(
    transaction: T & {
      ledgerEntries?: Array<{ metadata?: unknown }>;
      transferAttempts?: Array<{ metadata?: unknown }>;
      vtuOrders?: Array<{ metadata?: unknown; rawResponse?: unknown }>;
      exchangeReceipt?: { metadata?: unknown } | null;
    },
  ) {
    return {
      ...transaction,
      metadata: this.sanitizeMetadata(transaction.metadata),
      ledgerEntries: transaction.ledgerEntries?.map((entry) => ({
        ...entry,
        metadata: this.sanitizeMetadata(entry.metadata),
      })),
      transferAttempts: transaction.transferAttempts?.map((attempt) => ({
        ...attempt,
        metadata: this.sanitizeMetadata(attempt.metadata),
      })),
      vtuOrders: transaction.vtuOrders?.map((order) => ({
        ...order,
        metadata: this.sanitizeMetadata(order.metadata),
        rawResponse: this.sanitizeMetadata(order.rawResponse),
      })),
      exchangeReceipt: transaction.exchangeReceipt
        ? {
            ...transaction.exchangeReceipt,
            metadata: this.sanitizeMetadata(
              transaction.exchangeReceipt.metadata,
            ),
          }
        : null,
    };
  }

  private toVtuOrderAuditSnapshot(
    order: Awaited<ReturnType<VtuService['findOrderForAdmin']>>,
  ): Prisma.InputJsonValue {
    if (!order) {
      return {};
    }

    return {
      orderId: order.id,
      provider: order.provider,
      providerRequestId: order.providerRequestId,
      providerTransactionId: order.providerTransactionId,
      providerStatus: order.providerStatus,
      status: order.status,
      amount: order.amount.toString(),
      currency: order.currency,
      targetMasked: order.targetMasked,
      attempts: order.requeryAttempts,
      actionRequired:
        STALE_VTU_STATUSES.includes(order.status) &&
        order.transaction.status === 'PENDING' &&
        order.requeryAttempts >= VTU_REQUERY_MAX_ATTEMPTS,
      lastRequeryAt: order.lastRequeryAt?.toISOString() ?? null,
      nextRequeryAt: order.nextRequeryAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      failedAt: order.failedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      transaction: {
        id: order.transaction.id,
        reference: order.transaction.reference,
        status: order.transaction.status,
        amount: order.transaction.amount.toString(),
        currency: order.transaction.currency,
        type: order.transaction.type,
        createdAt: order.transaction.createdAt.toISOString(),
        updatedAt: order.transaction.updatedAt.toISOString(),
      },
    };
  }

  private toVtuPricingRuleAuditSnapshot(rule: {
    id: string;
    countryCode: string | null;
    serviceType: string | null;
    provider: string | null;
    scope: string | null;
    fixedMargin: Decimal;
    percentMargin: Decimal;
    minAmount: Decimal | null;
    maxAmount: Decimal | null;
    priority: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Prisma.InputJsonValue {
    return {
      id: rule.id,
      countryCode: rule.countryCode,
      serviceType: rule.serviceType,
      provider: rule.provider,
      scope: rule.scope,
      fixedMargin: rule.fixedMargin.toString(),
      percentMargin: rule.percentMargin.toString(),
      minAmount: rule.minAmount?.toString() ?? null,
      maxAmount: rule.maxAmount?.toString() ?? null,
      priority: rule.priority,
      isActive: rule.isActive,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  private assertOrderedTransferPolicyLimits(
    perTransaction: Decimal,
    daily: Decimal,
    monthly: Decimal,
  ) {
    if (
      !perTransaction.isFinite() ||
      !daily.isFinite() ||
      !monthly.isFinite() ||
      perTransaction.lessThanOrEqualTo(0) ||
      daily.lessThanOrEqualTo(0) ||
      monthly.lessThanOrEqualTo(0) ||
      perTransaction.greaterThan(daily) ||
      daily.greaterThan(monthly)
    ) {
      throw new BadRequestException(
        'Transfer policy limits must be positive and ordered perTransaction <= daily <= monthly',
      );
    }
  }

  private toInternalTransferLimitPolicyAuditSnapshot(
    policy: InternalTransferLimitPolicy,
  ): Prisma.InputJsonValue {
    return {
      id: policy.id,
      currency: policy.currency,
      kycTier: policy.kycTier,
      perTransaction: policy.perTransaction.toString(),
      daily: policy.daily.toString(),
      monthly: policy.monthly.toString(),
      enabled: policy.enabled,
      version: policy.version,
      requestedById: policy.requestedById,
      approvedById: policy.approvedById,
      reason: policy.reason,
      approvalReason: policy.approvalReason,
      approvedAt: policy.approvedAt?.toISOString() ?? null,
      effectiveFrom: policy.effectiveFrom.toISOString(),
      disabledAt: policy.disabledAt?.toISOString() ?? null,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  private toRequestAuditMetadata(
    context?: RequestAuditContext,
  ): Prisma.InputJsonValue | undefined {
    if (!context) return undefined;
    return {
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent ?? null,
      actorId: context.actorId ?? null,
      idempotencyKeyDigest: context.idempotencyKeyDigest ?? null,
    };
  }
}
