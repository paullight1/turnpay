import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import {
  AdminActionReasonDto,
  AdminAuditLogsQueryDto,
  AdminCreateVtuPricingRuleDto,
  AdminTransferVerificationDto,
  AdminUpdateVtuPricingRuleDto,
  AdminUpdateUserDto,
} from "./dto/admin.dto";
import { PinoLogger } from "nestjs-pino";
import {
  ExchangePayoutStatus,
  ExchangeReceiptStatus,
  Prisma,
  ProviderEventStatus,
  TransactionStatus,
  TransactionType,
  WalletCurrency,
  VtuOrderStatus,
  VtuOrderScope,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { LedgerService } from "../wallets/ledger.service";
import { PaystackProvider } from "../payments/providers/paystack.provider";
import { FlutterwaveProvider } from "../payments/providers/flutterwave.provider";
import { SupabaseService } from "../supabase/supabase.service";
import { VtuService } from "../vtu/vtu.service";
import { maskAccountNumber } from "../common/utils/masking";

const STALE_VTU_STATUSES: VtuOrderStatus[] = [
  "PENDING",
  "PROCESSING",
  "UNKNOWN",
];
const USER_SERVICE_ORDER: TransactionType[] = [
  "AIRTIME",
  "DATA",
  "CABLE",
  "ELECTRICITY",
  "EXCHANGE",
  "FUND",
  "WITHDRAW",
  "INTERNAL_TRANSFER",
];
const PLATFORM_SERVICE_TREND_DAYS = 7;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    private readonly ledger: LedgerService,
    private readonly paystack: PaystackProvider,
    private readonly flutterwave: FlutterwaveProvider,
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly vtuService: VtuService,
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

    if (role) whereClauses.push({ role: role as Prisma.UserWhereInput["role"] });
    if (kycStatus) {
      whereClauses.push({
        kycStatus: kycStatus as Prisma.UserWhereInput["kycStatus"],
      });
    }

    if (q) {
      whereClauses.push({
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { fullName: { contains: q, mode: "insensitive" } },
          { referralCode: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const where =
      whereClauses.length > 0 ? { AND: whereClauses } : undefined;

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
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
          orderBy: { currency: "asc" },
          select: {
            id: true,
            currency: true,
            balance: true,
            updatedAt: true,
          },
        },
        virtualAccounts: {
          orderBy: { createdAt: "desc" },
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
          orderBy: { createdAt: "desc" },
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
          orderBy: { lastUsedAt: "desc" },
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
          orderBy: { createdAt: "desc" },
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
          orderBy: { createdAt: "desc" },
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
          orderBy: { createdAt: "desc" },
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
          orderBy: { createdAt: "desc" },
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
      throw new NotFoundException("User not found");
    }

    const { refreshTokens, exchangePayouts, ...rest } = user;
    const relatedAuditClauses: Prisma.AuditLogWhereInput[] = [
      { targetType: "User", targetId: userId },
      {
        metadata: {
          path: ["userId"],
          equals: userId,
        },
      },
    ];

    const addTargetClause = (
      targetType: string,
      targetIds: string[],
    ) => {
      if (targetIds.length > 0) {
        relatedAuditClauses.push({
          targetType,
          targetId: { in: targetIds },
        });
      }
    };

    addTargetClause(
      "Transaction",
      user.transactions.map((transaction) => transaction.id),
    );
    addTargetClause(
      "UserSession",
      refreshTokens.map((session) => session.id),
    );
    addTargetClause(
      "Dispute",
      user.disputes.map((dispute) => dispute.id),
    );
    addTargetClause(
      "ExchangeReceipt",
      user.exchangeReceipts.map((receipt) => receipt.id),
    );
    addTargetClause(
      "ExchangePayout",
      exchangePayouts.map((payout) => payout.id),
    );

    const [auditLogs, serviceRows] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { OR: relatedAuditClauses },
        orderBy: { createdAt: "desc" },
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
        by: ["type", "currency"],
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

        return new Date(right.lastActivityAt ?? 0).getTime() -
          new Date(left.lastActivityAt ?? 0).getTime();
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
      throw new NotFoundException("Session not found");
    }

    if (session.revokedAt) {
      return { success: true };
    }

    const revokedAt = new Date();
    let sessionRevoked = false;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.refreshToken.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
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
          action: "USER_SESSION_REVOKE",
          targetType: "UserSession",
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
        { adminId, userId, sessionId, event: "admin_user_session_revoked" },
        "Admin revoked user session",
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
      throw new NotFoundException("User not found");
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
          kycTier: true,
          isSuspended: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: "USER_UPDATE",
          targetType: "User",
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
      "Admin updated user",
    );

    if (updates.role) {
      try {
        await this.supabaseService.setAuthAppRole(userId, updates.role);
      } catch (error) {
        this.logger.warn(
          {
            adminId,
            userId,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Unable to sync Supabase app_metadata role after admin role update",
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
        where: { status: "SUCCESS" },
      }),
      this.prisma.transaction.aggregate({
        _sum: { fee: true },
        where: { status: "SUCCESS" },
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
      orderBy: { createdAt: "desc" },
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
          orderBy: { createdAt: "asc" },
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
          orderBy: { createdAt: "desc" },
        },
        vtuOrders: {
          orderBy: { createdAt: "desc" },
        },
        exchangeReceipt: true,
        disputes: {
          orderBy: { createdAt: "desc" },
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
      throw new NotFoundException("Transaction not found");
    }

    return this.sanitizeTransactionDrilldown(transaction);
  }

  updateTransactionStatus(
    reference: string,
    status: TransactionStatus,
    adminId: string,
  ) {
    this.logger.warn(
      { adminId, reference, requestedStatus: status },
      "Blocked generic admin transaction status update",
    );
    throw new BadRequestException(
      "Generic transaction status updates are disabled. Use a typed audited banking operation.",
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
      this.prisma.virtualAccount.count({ where: { status: "ACTIVE" } }),
      this.prisma.virtualAccount.count({ where: { status: "FAILED" } }),
      this.prisma.transaction.count({
        where: { type: "WITHDRAW", status: "PENDING" },
      }),
      this.prisma.transferAttempt.count({
        where: { status: "PENDING", createdAt: { lt: staleCutoff } },
      }),
      this.prisma.providerEvent.count({ where: { status: "FAILED" } }),
      this.prisma.transferAttempt.count({ where: { status: "FAILED" } }),
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
      orderBy: { createdAt: "desc" },
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
      orderBy: { createdAt: "desc" },
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
        type: "WITHDRAW",
        status: "PENDING",
      },
      orderBy: { createdAt: "asc" },
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
          orderBy: { createdAt: "desc" },
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

    if (transaction.type !== "WITHDRAW") {
      throw new NotFoundException("Withdrawal not found");
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
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!transaction || transaction.type !== "WITHDRAW") {
      throw new NotFoundException("Withdrawal not found");
    }

    const latestAttempt = transaction.transferAttempts[0];
    if (!latestAttempt) {
      throw new BadRequestException("Withdrawal has no transfer attempt");
    }

    const providerVerification =
      await this.verifyProviderTransfer(latestAttempt);
    const verifiedStatus = this.mapTransferStatus(
      providerVerification.providerStatus,
    );

    if (["SUCCESS", "REVERSED"].includes(transaction.status)) {
      throw new BadRequestException("Terminal withdrawal cannot be changed");
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
            typeof latestAttempt.metadata === "object" &&
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
        ["FAILED", "REVERSED"].includes(verifiedStatus);

      if (shouldReverse) {
        const existingReversal = await tx.ledgerEntry.findFirst({
          where: {
            transactionId: transaction.id,
            source: "WITHDRAWAL_REVERSAL",
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
              source: "WITHDRAWAL_REVERSAL",
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
          action: "TRANSFER_VERIFY",
          targetType: "Transaction",
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
              ["FAILED", "REVERSED"].includes(verifiedStatus) &&
              updatedStatus.count === 1,
          },
        },
      });

      return tx.transaction.findUnique({
        where: { id: transaction.id },
        include: {
          transferAttempts: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
    });

    this.logger.info(
      { adminId, reference, status: verifiedStatus },
      "Admin verified withdrawal transfer",
    );

    return result;
  }

  async getReconciliationReport() {
    const staleCutoff = this.getStalePendingCutoff();

    const [providerEvents, transactions, localOnlyWithdrawals, stalePending] =
      await Promise.all([
        this.prisma.providerEvent.findMany({
          take: 200,
          orderBy: { createdAt: "desc" },
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
          orderBy: { createdAt: "desc" },
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
            type: "WITHDRAW",
            transferAttempts: { none: {} },
          },
          take: 100,
          orderBy: { createdAt: "desc" },
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
            status: "PENDING",
            createdAt: { lt: staleCutoff },
          },
          take: 100,
          orderBy: { createdAt: "asc" },
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
        action: "RECONCILIATION_RUN",
        targetType: "ReconciliationReport",
        targetId: `report-${Date.now()}`,
        reason: dto.reason,
        after: report,
        metadata: { summary: report.summary },
      },
    });

    return report;
  }

  async getStaleVtuOrders(olderThanMinutes = 10, limit = 50) {
    if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < 1) {
      throw new BadRequestException("olderThanMinutes must be at least 1");
    }

    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const orders = await this.prisma.vtuOrder.findMany({
      take: limit,
      where: {
        status: { in: STALE_VTU_STATUSES },
        createdAt: { lt: cutoff },
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
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
      },
    });

    return {
      generatedAt: new Date(),
      olderThanMinutes,
      cutoff,
      count: orders.length,
      orders: orders.map((order) => ({
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
        fee: order.fee,
        margin: order.margin,
        status: order.status,
        targetMasked: order.targetMasked,
        attempts: order.requeryAttempts,
        lastRequeryAt: order.lastRequeryAt,
        nextRequeryAt: order.nextRequeryAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        transactionCreatedAt: order.transaction.createdAt,
        transactionUpdatedAt: order.transaction.updatedAt,
      })),
    };
  }

  async getVtuProviderHealth() {
    return this.vtuService.getProviderHealth();
  }

  async getVtuReconciliationReport(olderThanMinutes = 10, limit = 50) {
    if (!Number.isInteger(olderThanMinutes) || olderThanMinutes < 1) {
      throw new BadRequestException("olderThanMinutes must be at least 1");
    }

    const generatedAt = new Date();
    const cutoff = new Date(generatedAt.getTime() - olderThanMinutes * 60000);
    const orders = await this.prisma.vtuOrder.findMany({
      take: limit,
      orderBy: [{ createdAt: "desc" }],
      select: {
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
      },
    });

    const summary = {
      ordersReviewed: orders.length,
      totalOrderAmount: new Decimal(0),
      totalFees: new Decimal(0),
      totalDebitAmount: new Decimal(0),
      amountMismatches: 0,
      feeMismatches: 0,
      missingDebitLedger: 0,
      staleOrders: 0,
      terminalWithoutReversalCredit: 0,
    };
    const providerBreakdown = new Map<
      string,
      {
        provider: string;
        count: number;
        totalAmount: Decimal;
        totalFees: Decimal;
        totalDebitAmount: Decimal;
      }
    >();
    const statusBreakdown = new Map<
      string,
      {
        status: string;
        count: number;
        totalAmount: Decimal;
        totalFees: Decimal;
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
      const orderFee = this.toDecimalOrZero(order.fee);
      const expectedDebit = orderAmount.plus(orderFee);
      const debitLedger = order.transaction.ledgerEntries.find(
        (entry) =>
          entry.source === "VTU_PURCHASE" && entry.direction === "DEBIT",
      );
      const reversalCredit = order.transaction.ledgerEntries.find(
        (entry) =>
          entry.source === "VTU_REVERSAL" && entry.direction === "CREDIT",
      );

      summary.totalOrderAmount = summary.totalOrderAmount.plus(orderAmount);
      summary.totalFees = summary.totalFees.plus(orderFee);
      summary.totalDebitAmount = summary.totalDebitAmount.plus(expectedDebit);
      this.addVtuBreakdown(
        providerBreakdown,
        "provider",
        order.provider,
        orderAmount,
        orderFee,
        expectedDebit,
      );
      this.addVtuBreakdown(
        statusBreakdown,
        "status",
        order.status,
        orderAmount,
        orderFee,
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

      if (
        STALE_VTU_STATUSES.includes(order.status) &&
        order.createdAt < cutoff
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

      if (["FAILED", "REVERSED"].includes(order.status) && !reversalCredit) {
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
      throw new NotFoundException("VTU order not found");
    }

    let requeryResult: Awaited<ReturnType<VtuService["requeryOrder"]>> | null =
      null;
    let requeryError: string | null = null;

    try {
      requeryResult = await this.vtuService.requeryOrder(before.id);
    } catch (error) {
      requeryError = error instanceof Error ? error.message : "Unknown error";
    }

    const after = await this.vtuService.findOrderForAdmin(before.id);

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: "VTU_ORDER_REQUERY",
        targetType: "VtuOrder",
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
        "Admin manual VTU order requery failed",
      );
      throw new BadRequestException("VTU order requery failed");
    }

    this.logger.info(
      {
        adminId,
        reference,
        orderId: before.id,
        status: after?.status,
      },
      "Admin manually requeried VTU order",
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
        { isActive: "desc" },
        { priority: "desc" },
        { createdAt: "desc" },
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
          action: "VTU_PRICING_RULE_CREATE",
          targetType: "VtuPricingRule",
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
      "Admin created VTU pricing rule",
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
      throw new NotFoundException("VTU pricing rule not found");
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
          action: "VTU_PRICING_RULE_UPDATE",
          targetType: "VtuPricingRule",
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

    this.logger.info({ adminId, ruleId }, "Admin updated VTU pricing rule");

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
      throw new NotFoundException("VTU pricing rule not found");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const rule = await tx.vtuPricingRule.update({
        where: { id: ruleId },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: "VTU_PRICING_RULE_DEACTIVATE",
          targetType: "VtuPricingRule",
          targetId: ruleId,
          reason: dto.reason,
          before: this.toVtuPricingRuleAuditSnapshot(existing),
          after: this.toVtuPricingRuleAuditSnapshot(rule),
        },
      });

      return rule;
    });

    this.logger.info({ adminId, ruleId }, "Admin deactivated VTU pricing rule");

    return updated;
  }

  async getAuditLogs(
    query: number | AdminAuditLogsQueryDto = 50,
  ) {
    const limit = typeof query === "number" ? query : query.limit ?? 50;
    const filters =
      typeof query === "number"
        ? {}
        : {
            q: query.q?.trim(),
            action: query.action?.trim(),
            targetType: query.targetType?.trim(),
            targetId: query.targetId?.trim(),
            adminId: query.adminId?.trim(),
            from: query.from,
            to: query.to,
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

    if (filters.q) {
      whereClauses.push({
        OR: [
          { action: { contains: filters.q, mode: "insensitive" } },
          { targetType: { contains: filters.q, mode: "insensitive" } },
          { targetId: { contains: filters.q, mode: "insensitive" } },
          { reference: { contains: filters.q, mode: "insensitive" } },
          { reason: { contains: filters.q, mode: "insensitive" } },
          {
            admin: {
              is: {
                email: { contains: filters.q, mode: "insensitive" },
              },
            },
          },
          {
            admin: {
              is: {
                fullName: { contains: filters.q, mode: "insensitive" },
              },
            },
          },
        ],
      });
    }

    const where =
      whereClauses.length > 0 ? { AND: whereClauses } : undefined;

    const logs = await this.prisma.auditLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
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
      throw new BadRequestException("limit must be between 1 and 100");
    }

    const receiptStatuses = {
      submitted: "SUBMITTED",
      underReview: "UNDER_REVIEW",
      approved: "APPROVED",
      credited: "CREDITED",
      rejected: "REJECTED",
      needsMoreInfo: "NEEDS_MORE_INFO",
    } as const satisfies Record<string, ExchangeReceiptStatus>;
    const payoutStatuses = {
      pendingApproval: "PENDING_APPROVAL",
      approved: "APPROVED",
      processing: "PROCESSING",
      sent: "SENT",
      failed: "FAILED",
      reversed: "REVERSED",
    } as const satisfies Record<string, ExchangePayoutStatus>;
    const vtuOrderStatuses: VtuOrderStatus[] = [
      "PENDING",
      "PROCESSING",
      "SUCCESS",
      "FAILED",
      "REVERSED",
      "UNKNOWN",
    ];
    const serviceOrder: TransactionType[] = [
      "AIRTIME",
      "DATA",
      "CABLE",
      "ELECTRICITY",
    ];
    const platformServiceTrendStart = new Date();
    platformServiceTrendStart.setUTCHours(0, 0, 0, 0);
    platformServiceTrendStart.setUTCDate(
      platformServiceTrendStart.getUTCDate() - (PLATFORM_SERVICE_TREND_DAYS - 1),
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
      this.prisma.user.count({ where: { kycStatus: "VERIFIED" } }),
      this.prisma.wallet.groupBy({
        by: ["currency"],
        _count: { _all: true },
        _sum: { balance: true },
      }),
      this.prisma.exchangeReceipt.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: {
          amount: true,
          expectedCreditAmount: true,
        },
      }),
      this.prisma.exchangePayout.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: {
          sourceAmount: true,
          destinationAmount: true,
          fee: true,
        },
      }),
      this.prisma.transaction.groupBy({
        by: ["type", "currency"],
        where: { status: "SUCCESS" },
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
          status: "SUCCESS",
          type: { in: USER_SERVICE_ORDER },
          createdAt: {
            gte: platformServiceTrendStart,
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          type: true,
          currency: true,
          amount: true,
          fee: true,
          createdAt: true,
        },
      }),
      this.prisma.vtuOrder.groupBy({
        by: ["serviceType"],
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
          status: { in: ["PENDING", "PROCESSING", "UNKNOWN"] },
        },
      }),
      this.prisma.transaction.findMany({
        take: limit,
        orderBy: { createdAt: "desc" },
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
        orderBy: { createdAt: "desc" },
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
        return (
          (order[left.currency] ?? 99) - (order[right.currency] ?? 99)
        );
      });

    const totalWalletExposure = walletExposureByCurrency
      .reduce((total, entry) => total.plus(new Decimal(entry.balance)), new Decimal(0))
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
          USER_SERVICE_ORDER.indexOf(left.serviceType as TransactionType) -
          USER_SERVICE_ORDER.indexOf(right.serviceType as TransactionType);
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
          serviceOrder.indexOf(left.serviceType as TransactionType) -
          serviceOrder.indexOf(right.serviceType as TransactionType),
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
        (total, entry) => total.plus(this.toDecimalOrZero(entry._sum.costAmount)),
        new Decimal(0),
      )
      .toFixed(2);
    const totalVtuMargin = vtuBuckets
      .reduce(
        (total, entry) => total.plus(this.toDecimalOrZero(entry._sum.margin)),
        new Decimal(0),
      )
      .toFixed(2);

    const settlementAccountNumber =
      this.configService.get<string>(
        "MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER",
        "",
      )?.trim() || "";

    return {
      generatedAt: new Date(),
      stats: {
        ...stats,
        suspendedUsers,
        verifiedUsers,
      },
      treasury: {
        settlementAccount: {
          provider: "MONNIFY",
          configured: settlementAccountNumber.length > 0,
          accountNumberMasked: settlementAccountNumber
            ? maskAccountNumber(settlementAccountNumber)
            : null,
          note: settlementAccountNumber
            ? "Exchange deposits settle to the configured Monnify collection account."
            : "Configure MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER to lock exchange deposits to one settlement account.",
        },
        walletExposure: walletExposureByCurrency,
        totalWalletExposure,
      },
      exchange: {
        receipts: {
          ...receiptStatusCounts,
          totalSourceAmount: receiptTotals.sourceAmount.toFixed(2),
          totalExpectedCreditAmount: receiptTotals.expectedCreditAmount.toFixed(
            2,
          ),
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
    metadata: unknown;
  }) {
    if (latestAttempt.provider === "PAYSTACK") {
      const transfer = await this.paystack.verifyTransfer(
        latestAttempt.providerReference,
      );

      return {
        providerStatus: transfer.status,
        payload: transfer,
      };
    }

    if (latestAttempt.provider !== "FLUTTERWAVE") {
      throw new BadRequestException(
        "Provider transfer verification is not supported for this provider",
      );
    }

    const metadata =
      latestAttempt.metadata &&
      typeof latestAttempt.metadata === "object" &&
      !Array.isArray(latestAttempt.metadata)
        ? (latestAttempt.metadata as Record<string, unknown>)
        : {};
    const providerTransferId = Number(metadata.providerTransferId);

    if (!Number.isFinite(providerTransferId)) {
      throw new BadRequestException(
        "Flutterwave transfer id is required for provider verification",
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
      ["success", "successful", "completed", "complete"].includes(normalized)
    ) {
      return "SUCCESS";
    }

    if (normalized === "reversed") {
      return "REVERSED";
    }

    if (["failed", "abandoned", "blocked", "rejected"].includes(normalized)) {
      return "FAILED";
    }

    return "PENDING";
  }

  private assertReason(reason: string) {
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException(
        "A reason of at least 10 characters is required",
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

  private groupStatusCounts<
    TStatusMap extends Record<string, string>,
  >(
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
      throw new BadRequestException("VTU margins cannot be negative");
    }

    if (percentMargin.greaterThan(100)) {
      throw new BadRequestException("VTU percent margin cannot exceed 100");
    }

    if (input.minAmount && input.maxAmount) {
      const minAmount = new Decimal(input.minAmount);
      const maxAmount = new Decimal(input.maxAmount);
      if (minAmount.greaterThan(maxAmount)) {
        throw new BadRequestException("minAmount cannot exceed maxAmount");
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
      currencyBucket.fee = currencyBucket.fee.plus(this.toDecimalOrZero(row.fee));
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
        totalFees: Decimal;
        totalDebitAmount: Decimal;
      }
    >,
    label: "provider" | "status",
    key: string,
    amount: Decimal,
    fee: Decimal,
    debitAmount: Decimal,
  ) {
    const existing = breakdown.get(key) ?? {
      [label]: key,
      count: 0,
      totalAmount: new Decimal(0),
      totalFees: new Decimal(0),
      totalDebitAmount: new Decimal(0),
    };

    existing.count += 1;
    existing.totalAmount = existing.totalAmount.plus(amount);
    existing.totalFees = existing.totalFees.plus(fee);
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
        totalFees: Decimal;
        totalDebitAmount: Decimal;
      }
    >,
  ) {
    return Array.from(breakdown.values()).map((item) => ({
      ...item,
      currency: "NGN",
      amount: item.totalAmount.toString(),
      costAmount: item.totalAmount.toString(),
      fees: item.totalFees.toString(),
      margin: item.totalFees.toString(),
      totalAmount: item.totalAmount.toString(),
      totalFees: item.totalFees.toString(),
      totalDebitAmount: item.totalDebitAmount.toString(),
    }));
  }

  private stringifyVtuReconciliationSummary(summary: {
    ordersReviewed: number;
    totalOrderAmount: Decimal;
    totalFees: Decimal;
    totalDebitAmount: Decimal;
    amountMismatches: number;
    feeMismatches: number;
    missingDebitLedger: number;
    staleOrders: number;
    terminalWithoutReversalCredit: number;
  }) {
    return {
      ...summary,
      totalOrders: summary.ordersReviewed,
      totalAmount: summary.totalOrderAmount.toString(),
      totalCostAmount: summary.totalOrderAmount.toString(),
      totalMargin: summary.totalFees.toString(),
      missingDebits: summary.missingDebitLedger,
      missingReversals: summary.terminalWithoutReversalCredit,
      highRiskExceptions:
        summary.amountMismatches +
        summary.missingDebitLedger +
        summary.terminalWithoutReversalCredit,
      currency: "NGN",
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
    };
  }

  private getStalePendingCutoff() {
    return new Date(Date.now() - 30 * 60 * 1000);
  }

  private extractProviderAmount(payload: unknown): Decimal | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const eventPayload = payload as { data?: { amount?: unknown } };
    const rawAmount = eventPayload.data?.amount;

    if (rawAmount === undefined || rawAmount === null) {
      return null;
    }

    if (typeof rawAmount !== "string" && typeof rawAmount !== "number") {
      return null;
    }

    const decimalAmount = new Decimal(rawAmount);
    if (!decimalAmount.isFinite()) {
      return null;
    }

    return decimalAmount;
  }

  private sanitizeMetadata(metadata: unknown) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
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
    order: Awaited<ReturnType<VtuService["findOrderForAdmin"]>>,
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
}
