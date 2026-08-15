import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { AdminService } from "./admin.service";

describe("AdminService banking operations", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    transaction: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
    },
    refreshToken: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    transferAttempt: {
      update: jest.fn(),
    },
    wallet: {
      groupBy: jest.fn(),
    },
    exchangeReceipt: {
      groupBy: jest.fn(),
    },
    exchangePayout: {
      groupBy: jest.fn(),
    },
    vtuOrder: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    vtuPricingRule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    webhookLog: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    providerEvent: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg),
    ),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  const ledger = {
    creditWallet: jest.fn(),
  };

  const paystack = {
    verifyTransfer: jest.fn(),
  };

  const flutterwave = {
    verifyTransfer: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === "MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER") {
        return "0123456789";
      }

      return defaultValue;
    }),
  };

  const supabase = {
    setAuthAppRole: jest.fn(),
  };

  const vtuService = {
    findOrderForAdmin: jest.fn(),
    requeryOrder: jest.fn(),
    getProviderHealth: jest.fn(),
  };

  const bankingService = {
    processVirtualAccountDeposit: jest.fn(),
  };

  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(
      prisma,
      logger as any,
      ledger as any,
      paystack as any,
      flutterwave as any,
      configService as any,
      supabase as any,
      vtuService as any,
      bankingService as any,
    );
  });

  it("builds an admin ops summary with masked settlement details and live activity data", async () => {
    prisma.user.count
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(45)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(100);
    prisma.transaction.count.mockResolvedValueOnce(400);
    prisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Decimal(500000) } })
      .mockResolvedValueOnce({ _sum: { fee: new Decimal(1250) } });
    prisma.wallet.groupBy.mockResolvedValue([
      {
        currency: "NGN",
        _count: { _all: 2 },
        _sum: { balance: new Decimal(400000) },
      },
      {
        currency: "GHS",
        _count: { _all: 3 },
        _sum: { balance: new Decimal(250000) },
      },
    ]);
    prisma.exchangeReceipt.groupBy.mockResolvedValue([
      {
        status: "SUBMITTED",
        _count: { _all: 4 },
        _sum: {
          amount: new Decimal(12000),
          expectedCreditAmount: new Decimal(38100),
        },
      },
      {
        status: "CREDITED",
        _count: { _all: 6 },
        _sum: {
          amount: new Decimal(20000),
          expectedCreditAmount: new Decimal(63000),
        },
      },
    ]);
    prisma.exchangePayout.groupBy.mockResolvedValue([
      {
        status: "PENDING_APPROVAL",
        _count: { _all: 2 },
        _sum: {
          sourceAmount: new Decimal(10000),
          destinationAmount: new Decimal(31500),
          fee: new Decimal(250),
        },
      },
      {
        status: "SENT",
        _count: { _all: 5 },
        _sum: {
          sourceAmount: new Decimal(30000),
          destinationAmount: new Decimal(94500),
          fee: new Decimal(750),
        },
      },
    ]);
    prisma.transaction.groupBy.mockResolvedValue([
      {
        type: "AIRTIME",
        currency: "NGN",
        _count: { _all: 3 },
        _sum: {
          amount: new Decimal(3000),
          fee: new Decimal(120),
        },
        _max: {
          createdAt: new Date("2026-05-21T12:00:00.000Z"),
        },
      },
      {
        type: "DATA",
        currency: "NGN",
        _count: { _all: 2 },
        _sum: {
          amount: new Decimal(5000),
          fee: new Decimal(180),
        },
        _max: {
          createdAt: new Date("2026-05-21T12:05:00.000Z"),
        },
      },
      {
        type: "EXCHANGE",
        currency: "NGN",
        _count: { _all: 4 },
        _sum: {
          amount: new Decimal(7000),
          fee: new Decimal(140),
        },
        _max: {
          createdAt: new Date("2026-05-21T12:10:00.000Z"),
        },
      },
      {
        type: "WITHDRAW",
        currency: "NGN",
        _count: { _all: 1 },
        _sum: {
          amount: new Decimal(2500),
          fee: new Decimal(25),
        },
        _max: {
          createdAt: new Date("2026-05-21T12:15:00.000Z"),
        },
      },
    ]);
    prisma.vtuOrder.groupBy.mockResolvedValue([
      {
        serviceType: "AIRTIME",
        _count: { _all: 3 },
        _sum: {
          amount: new Decimal(3000),
          fee: new Decimal(120),
          costAmount: new Decimal(3120),
          margin: new Decimal(120),
        },
      },
      {
        serviceType: "DATA",
        _count: { _all: 2 },
        _sum: {
          amount: new Decimal(5000),
          fee: new Decimal(180),
          costAmount: new Decimal(5180),
          margin: new Decimal(180),
        },
      },
    ]);
    prisma.vtuOrder.count.mockResolvedValueOnce(7);
    const trendToday = new Date();
    trendToday.setUTCHours(12, 0, 0, 0);
    const trendYesterday = new Date(trendToday);
    trendYesterday.setUTCDate(trendYesterday.getUTCDate() - 1);
    prisma.transaction.findMany
      .mockResolvedValueOnce([
        {
          type: "AIRTIME",
          currency: "NGN",
          amount: new Decimal(1500),
          fee: new Decimal(45),
          createdAt: trendToday,
        },
        {
          type: "AIRTIME",
          currency: "NGN",
          amount: new Decimal(500),
          fee: new Decimal(15),
          createdAt: trendToday,
        },
        {
          type: "EXCHANGE",
          currency: "GHS",
          amount: new Decimal(250),
          fee: new Decimal(5),
          createdAt: trendToday,
        },
        {
          type: "DATA",
          currency: "NGN",
          amount: new Decimal(700),
          fee: new Decimal(20),
          createdAt: trendYesterday,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "tx-1",
          reference: "TX-1",
          type: "AIRTIME",
          amount: new Decimal(500),
          currency: "NGN",
          status: "SUCCESS",
          fee: new Decimal(10),
          createdAt: new Date("2026-05-21T10:00:00.000Z"),
          user: {
            id: "user-1",
            email: "ada@example.com",
            phone: "+2348012345678",
          },
        },
      ]);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-1",
        action: "USER_SUSPEND",
        targetType: "User",
        targetId: "user-1",
        reference: "USR-1",
        reason: "Fraud review",
        createdAt: new Date("2026-05-21T11:00:00.000Z"),
        admin: {
          id: "admin-1",
          email: "ops@example.com",
          fullName: "Ops Admin",
        },
      },
    ]);

    const summary = await service.getOpsSummary(8);

    expect(summary.stats).toEqual(
      expect.objectContaining({
        totalUsers: 120,
        activeUsers: 45,
        suspendedUsers: 8,
        verifiedUsers: 100,
      }),
    );
    expect(summary.treasury).toEqual(
      expect.objectContaining({
        settlementAccount: expect.objectContaining({
          configured: true,
          accountNumberMasked: "******6789",
        }),
        totalWalletExposure: "650000.00",
      }),
    );
    expect(summary.exchange.receipts).toEqual(
      expect.objectContaining({
        submitted: 4,
        credited: 6,
        totalSourceAmount: "32000.00",
        totalExpectedCreditAmount: "101100.00",
      }),
    );
    expect(summary.exchange.payouts).toEqual(
      expect.objectContaining({
        pendingApproval: 2,
        sent: 5,
        totalSourceAmount: "40000.00",
        totalDestinationAmount: "126000.00",
        totalFees: "1000.00",
      }),
    );
    expect(summary.platformServices).toEqual(
      expect.objectContaining({
        totalTransactions: 10,
        totalAmount: "17500.00",
        totalFees: "465.00",
        breakdown: expect.arrayContaining([
          expect.objectContaining({
            serviceType: "AIRTIME",
            currency: "NGN",
            transactionCount: 3,
            amount: "3000.00",
            fee: "120.00",
          }),
          expect.objectContaining({
            serviceType: "EXCHANGE",
            currency: "NGN",
            transactionCount: 4,
            amount: "7000.00",
            fee: "140.00",
          }),
        ]),
        trend: expect.arrayContaining([
          expect.objectContaining({
            transactionCount: 3,
            topServiceType: "AIRTIME",
            topServiceCount: 2,
            currencyBreakdown: expect.arrayContaining([
              expect.objectContaining({
                currency: "NGN",
                transactionCount: 2,
                amount: "2000.00",
                fee: "60.00",
              }),
              expect.objectContaining({
                currency: "GHS",
                transactionCount: 1,
                amount: "250.00",
                fee: "5.00",
              }),
            ]),
          }),
          expect.objectContaining({
            transactionCount: 1,
            topServiceType: "DATA",
          }),
        ]),
      }),
    );
    expect(summary.platformServices.trend).toHaveLength(7);
    expect(summary.vtu).toEqual(
      expect.objectContaining({
        totalOrders: 5,
        openOrders: 7,
        totalAmount: "8000.00",
        totalFees: "300.00",
        serviceBreakdown: expect.arrayContaining([
          expect.objectContaining({
            serviceType: "AIRTIME",
            orderCount: 3,
            amount: "3000.00",
          }),
        ]),
      }),
    );
    expect(summary.activity.recentTransactions[0]).toEqual(
      expect.objectContaining({
        reference: "TX-1",
        amount: "500.00",
        fee: "10.00",
      }),
    );
    expect(summary.activity.recentAuditLogs[0]).toEqual(
      expect.objectContaining({
        action: "USER_SUSPEND",
        admin: expect.objectContaining({
          email: "ops@example.com",
        }),
      }),
    );
  });

  it("filters admin users by search text, role, and KYC status", async () => {
    prisma.user.findMany.mockResolvedValueOnce([]);
    prisma.user.count.mockResolvedValueOnce(0);

    await service.getUsers(1, 25, "USER", "VERIFIED", "Ada");

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 25,
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ role: "USER" }),
            expect.objectContaining({ kycStatus: "VERIFIED" }),
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  email: expect.objectContaining({
                    contains: "Ada",
                    mode: "insensitive",
                  }),
                }),
                expect.objectContaining({
                  phone: expect.objectContaining({
                    contains: "Ada",
                    mode: "insensitive",
                  }),
                }),
                expect.objectContaining({
                  fullName: expect.objectContaining({
                    contains: "Ada",
                    mode: "insensitive",
                  }),
                }),
                expect.objectContaining({
                  referralCode: expect.objectContaining({
                    contains: "Ada",
                    mode: "insensitive",
                  }),
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.any(Array),
        }),
      }),
    );
  });

  it("returns an enriched user drilldown with account, support, and exchange context", async () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "ada@example.com",
      phone: "+2348012345678",
      role: "USER",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
      createdAt: now,
      updatedAt: now,
      wallets: [
        {
          id: "wallet-ngn",
          currency: "NGN",
          balance: new Decimal(4200),
          updatedAt: now,
        },
        {
          id: "wallet-ghs",
          currency: "GHS",
          balance: new Decimal(88),
          updatedAt: now,
        },
      ],
      virtualAccounts: [
        {
          id: "va-1",
          provider: "MONNIFY",
          providerAccountId: "res-1",
          accountNumberMasked: "******7890",
          accountName: "Ada Lovelace",
          bankName: "Moniepoint Microfinance Bank",
          bankCode: "50515",
          currency: "NGN",
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        },
      ],
      bankAccounts: [
        {
          id: "bank-1",
          provider: "MONNIFY",
          bankCode: "058",
          bankName: "Guaranty Trust Bank",
          accountName: "Ada Lovelace",
          accountNumberMasked: "******4321",
          currency: "NGN",
          isDeleted: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      refreshTokens: [
        {
          id: "session-1",
          userId: "user-1",
          deviceId: "device-1",
          deviceName: "Chrome on iPhone",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
          ipAddress: "127.0.0.1",
          lastUsedAt: now,
          expiresAt: new Date("2026-05-28T12:00:00.000Z"),
          createdAt: now,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          type: "EXCHANGE",
          amount: new Decimal(100),
          currency: "NGN",
          status: "SUCCESS",
          reference: "TX-1",
          createdAt: now,
        },
      ],
      disputes: [
        {
          id: "ticket-1",
          type: "EXCHANGE",
          status: "OPEN",
          description: "Exchange deposit pending review",
          resolution: null,
          createdAt: now,
          updatedAt: now,
          transaction: {
            id: "tx-1",
            reference: "TX-1",
            type: "EXCHANGE",
            amount: new Decimal(100),
            currency: "NGN",
            status: "SUCCESS",
            createdAt: now,
          },
        },
      ],
      exchangeReceipts: [
        {
          id: "receipt-1",
          bankReference: "BANK-REF-1",
          amount: new Decimal(100),
          expectedCreditAmount: new Decimal(63),
          status: "CREDITED",
          createdAt: now,
          updatedAt: now,
          transaction: {
            id: "tx-2",
            reference: "EX-1",
            type: "EXCHANGE",
            status: "SUCCESS",
            createdAt: now,
          },
        },
      ],
      exchangePayouts: [
        {
          id: "payout-1",
          status: "SENT",
          sourceAmount: new Decimal(100),
          destinationAmount: new Decimal(63),
          destinationBankName: "GTBank",
          destinationAccountNumber: "1234567890",
          destinationAccountName: "Ada Lovelace",
          reviewedAt: now,
          sentAt: now,
          createdAt: now,
          updatedAt: now,
          transaction: {
            id: "tx-3",
            reference: "PAY-1",
            type: "EXCHANGE",
            status: "SUCCESS",
            createdAt: now,
          },
        },
      ],
    });
    prisma.transaction.groupBy.mockResolvedValueOnce([
      {
        type: "AIRTIME",
        currency: "NGN",
        _count: { _all: 3 },
        _sum: {
          amount: new Decimal(1500),
          fee: new Decimal(45),
        },
        _max: {
          createdAt: now,
        },
      },
      {
        type: "DATA",
        currency: "NGN",
        _count: { _all: 2 },
        _sum: {
          amount: new Decimal(2500),
          fee: new Decimal(60),
        },
        _max: {
          createdAt: now,
        },
      },
    ]);
    prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: "audit-1",
        adminId: "admin-1",
        admin: {
          id: "admin-1",
          email: "ops@example.com",
          fullName: "Ops Admin",
        },
        action: "USER_UPDATE",
        targetType: "User",
        targetId: "user-1",
        reference: "USR-1",
        reason: "Updated profile after verification",
        before: { fullName: "Ada" },
        after: { fullName: "Ada Lovelace" },
        metadata: { fields: ["fullName"] },
        createdAt: now,
      },
    ]);

    const result = await service.getUserById("user-1");

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        select: expect.objectContaining({
          wallets: expect.any(Object),
          virtualAccounts: expect.any(Object),
          bankAccounts: expect.any(Object),
          refreshTokens: expect.any(Object),
          disputes: expect.any(Object),
          exchangeReceipts: expect.any(Object),
          exchangePayouts: expect.any(Object),
        }),
      }),
    );
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              targetType: "User",
              targetId: "user-1",
            }),
          ]),
        }),
      }),
    );
    expect(result.wallets).toHaveLength(2);
    expect(result.virtualAccounts).toHaveLength(1);
    expect(result.bankAccounts).toHaveLength(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.serviceStats).toHaveLength(2);
    expect(result.auditLogs).toHaveLength(1);
    expect(result.disputes).toHaveLength(1);
    expect(result.exchangeReceipts).toHaveLength(1);
    expect(result.exchangePayouts[0].destinationAccountNumber).toBe(
      "******7890",
    );
    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        id: "session-1",
        deviceId: "device-1",
        deviceName: "Chrome on iPhone",
      }),
    );
    expect(result.serviceStats[0]).toEqual(
      expect.objectContaining({
        type: "AIRTIME",
        currency: "NGN",
        transactionCount: 3,
        totalAmount: "1500.00",
        totalFees: "45.00",
      }),
    );
    expect(result.auditLogs[0]).toEqual(
      expect.objectContaining({
        action: "USER_UPDATE",
        targetType: "User",
        admin: expect.objectContaining({
          email: "ops@example.com",
        }),
      }),
    );
  });

  it("suspends a user and records an audited account control action", async () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "ada@example.com",
      phone: "+2348012345678",
      role: "USER",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
      createdAt: now,
      updatedAt: now,
    });
    prisma.user.update.mockResolvedValueOnce({
      id: "user-1",
      email: "ada@example.com",
      phone: "+2348012345678",
      role: "USER",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: true,
      updatedAt: now,
    });

    await expect(
      service.suspendUser("user-1", "admin-1", {
        reason: "Suspicious account activity from review",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        isSuspended: true,
      }),
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          isSuspended: true,
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "USER_UPDATE",
        targetType: "User",
        targetId: "user-1",
        reason: "Suspicious account activity from review",
      }),
    });
  });

  it("unsuspends a user and records an audited account control action", async () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "ada@example.com",
      phone: "+2348012345678",
      role: "USER",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: true,
      createdAt: now,
      updatedAt: now,
    });
    prisma.user.update.mockResolvedValueOnce({
      id: "user-1",
      email: "ada@example.com",
      phone: "+2348012345678",
      role: "USER",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
      updatedAt: now,
    });

    await expect(
      service.unsuspendUser("user-1", "admin-1", {
        reason: "Issue resolved after review",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        isSuspended: false,
      }),
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          isSuspended: false,
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "USER_UPDATE",
        targetType: "User",
        targetId: "user-1",
        reason: "Issue resolved after review",
      }),
    });
  });

  it("revokes a user session and audits the action", async () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    prisma.refreshToken.findFirst.mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      deviceId: "device-1",
      deviceName: "Chrome on iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      ipAddress: "127.0.0.1",
      lastUsedAt: now,
      expiresAt: new Date("2026-05-28T12:00:00.000Z"),
      revokedAt: null,
      createdAt: now,
    });
    prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      service.revokeUserSession(
        "user-1",
        "session-1",
        { reason: "Suspicious login from admin review" },
        "admin-1",
      ),
    ).resolves.toEqual({ success: true });

    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "session-1", userId: "user-1" },
      }),
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        userId: "user-1",
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "USER_SESSION_REVOKE",
        targetType: "UserSession",
        targetId: "session-1",
        reference: "device-1",
        reason: "Suspicious login from admin review",
        before: expect.objectContaining({
          id: "session-1",
          revokedAt: null,
        }),
        after: expect.objectContaining({
          id: "session-1",
          revokedAt: expect.any(String),
        }),
        metadata: expect.objectContaining({
          userId: "user-1",
          deviceName: "Chrome on iPhone",
          ipAddress: "127.0.0.1",
        }),
      }),
    });
  });

  it("returns audit logs with admin identity and sanitized payloads", async () => {
    prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: "audit-2",
        adminId: "admin-1",
        admin: {
          id: "admin-1",
          email: "ops@example.com",
          fullName: "Ops Admin",
        },
        action: "USER_UPDATE",
        targetType: "User",
        targetId: "user-1",
        reference: "USR-1",
        reason: "Updated profile after verification",
        before: { phone: "+2348000000000" },
        after: { phone: "+2348011111111" },
        metadata: { fields: ["phone"] },
        createdAt: new Date("2026-05-21T12:00:00.000Z"),
      },
    ]);

    const logs = await service.getAuditLogs(5);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        select: expect.objectContaining({
          admin: expect.any(Object),
        }),
      }),
    );
    expect(logs[0]).toEqual(
      expect.objectContaining({
        adminId: "admin-1",
        admin: expect.objectContaining({
          email: "ops@example.com",
          fullName: "Ops Admin",
        }),
        action: "USER_UPDATE",
        targetType: "User",
        before: expect.objectContaining({
          phone: "+2348000000000",
        }),
        metadata: expect.objectContaining({
          fields: ["phone"],
        }),
      }),
    );
  });

  it("filters audit logs by search text, target type, actor, and date range", async () => {
    prisma.auditLog.findMany.mockResolvedValueOnce([]);

    await service.getAuditLogs({
      limit: 25,
      q: "approve",
      action: "EXCHANGE_PAYOUT_APPROVED",
      targetType: "ExchangePayout",
      targetId: "payout-1",
      adminId: "11111111-1111-4111-8111-111111111111",
      from: "2026-05-21T00:00:00.000Z",
      to: "2026-05-22T00:00:00.000Z",
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              action: "EXCHANGE_PAYOUT_APPROVED",
            }),
            expect.objectContaining({
              targetType: "ExchangePayout",
            }),
            expect.objectContaining({
              targetId: "payout-1",
            }),
            expect.objectContaining({
              adminId: "11111111-1111-4111-8111-111111111111",
            }),
            expect.objectContaining({
              createdAt: expect.objectContaining({
                gte: new Date("2026-05-21T00:00:00.000Z"),
                lte: new Date("2026-05-22T00:00:00.000Z"),
              }),
            }),
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  action: expect.objectContaining({
                    contains: "approve",
                    mode: "insensitive",
                  }),
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("verifies withdrawal status from provider and audits the action", async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      type: "WITHDRAW",
      status: "PENDING",
      amount: new Decimal(1000),
      currency: "NGN",
      reference: "WD-1",
      transferAttempts: [
        {
          id: "attempt-1",
          provider: "PAYSTACK",
          providerReference: "WD-1",
          providerStatus: "pending",
          status: "PENDING",
          metadata: { accountNumberMasked: "******6789" },
        },
      ],
    });
    paystack.verifyTransfer.mockResolvedValue({
      status: "success",
      reference: "WD-1",
      amount: 100000,
      currency: "NGN",
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    await service.verifyTransfer(
      "WD-1",
      { reason: "Provider dashboard confirms payout completed" },
      "admin-1",
    );

    expect(paystack.verifyTransfer).toHaveBeenCalledWith("WD-1");
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", status: "PENDING" },
      data: { status: "SUCCESS" },
    });
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "attempt-1" },
        data: expect.objectContaining({
          status: "SUCCESS",
          providerStatus: "success",
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "TRANSFER_VERIFY",
        reference: "WD-1",
        reason: "Provider dashboard confirms payout completed",
      }),
    });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it("reverses a failed provider withdrawal only when no reversal exists", async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      type: "WITHDRAW",
      status: "PENDING",
      amount: new Decimal(1000),
      currency: "NGN",
      reference: "WD-1",
      transferAttempts: [
        {
          id: "attempt-1",
          provider: "PAYSTACK",
          providerReference: "WD-1",
          providerStatus: "pending",
          status: "PENDING",
          metadata: {},
        },
      ],
    });
    paystack.verifyTransfer.mockResolvedValue({ status: "failed" });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await service.verifyTransfer(
      "WD-1",
      { reason: "Provider confirms transfer failed" },
      "admin-1",
    );

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        transactionId: "tx-1",
        reference: "WD-1-REVERSAL",
        source: "WITHDRAWAL_REVERSAL",
      }),
      prisma,
    );
  });

  it("blocks generic status updates for withdrawal transactions", async () => {
    prisma.transaction.findUnique.mockResolvedValue({ type: "WITHDRAW" });

    expect(() =>
      service.updateTransactionStatus("WD-1", "SUCCESS", "admin-1"),
    ).toThrow(BadRequestException);
  });

  it("lists stale pending VTU orders with masked target and references", async () => {
    const createdAt = new Date("2026-05-21T10:00:00.000Z");
    prisma.vtuOrder.findMany.mockResolvedValue([
      {
        id: "order-1",
        provider: "VTPASS",
        providerRequestId: "REQ-1",
        providerTransactionId: "PROV-TX-1",
        providerStatus: "pending",
        status: "PENDING",
        serviceType: "AIRTIME",
        amount: new Decimal(500),
        currency: "NGN",
        targetMasked: "******1234",
        requeryAttempts: 2,
        lastRequeryAt: null,
        nextRequeryAt: null,
        createdAt,
        updatedAt: createdAt,
        transaction: {
          id: "tx-1",
          reference: "VTU-1",
          status: "PENDING",
          createdAt,
          updatedAt: createdAt,
        },
      },
    ]);

    const result = await service.getStaleVtuOrders(10, 25);

    expect(prisma.vtuOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        where: expect.objectContaining({
          status: { in: ["PENDING", "PROCESSING", "UNKNOWN"] },
        }),
      }),
    );
    expect(result.orders[0]).toEqual(
      expect.objectContaining({
        orderId: "order-1",
        providerRequestId: "REQ-1",
        providerTransactionId: "PROV-TX-1",
        transactionReference: "VTU-1",
        targetMasked: "******1234",
        attempts: 2,
      }),
    );
  });

  it("returns VTU provider health from the VTU service", async () => {
    const health = {
      generatedAt: new Date("2026-05-22T10:00:00.000Z"),
      providers: [
        {
          id: "vtpass",
          name: "VTpass",
          configured: true,
          enabled: true,
          supportsBalance: true,
          balance: { status: "available", amount: "10000", currency: "NGN" },
          warnings: [],
        },
      ],
    };
    vtuService.getProviderHealth.mockResolvedValue(health);

    await expect(service.getVtuProviderHealth()).resolves.toBe(health);
    expect(vtuService.getProviderHealth).toHaveBeenCalledTimes(1);
  });

  it("builds a VTU reconciliation report with string money totals and exception buckets", async () => {
    const createdAt = new Date(Date.now() - 20 * 60 * 1000);
    prisma.vtuOrder.findMany.mockResolvedValue([
      {
        id: "order-1",
        provider: "VTPASS",
        providerRequestId: "REQ-1",
        providerTransactionId: "PROV-TX-1",
        providerStatus: "pending",
        scope: "LOCAL",
        serviceType: "AIRTIME",
        countryCode: "NG",
        localProvider: "mtn",
        operatorId: null,
        amount: new Decimal(500),
        currency: "NGN",
        costAmount: new Decimal(500),
        fee: new Decimal(10),
        margin: new Decimal(10),
        status: "PENDING",
        targetMasked: "******1234",
        requeryAttempts: 2,
        lastRequeryAt: null,
        nextRequeryAt: null,
        completedAt: null,
        failedAt: null,
        createdAt,
        updatedAt: createdAt,
        transaction: {
          id: "tx-1",
          reference: "VTU-1",
          type: "AIRTIME",
          amount: new Decimal(500),
          fee: new Decimal(15),
          currency: "NGN",
          status: "PENDING",
          createdAt,
          updatedAt: createdAt,
          ledgerEntries: [
            {
              id: "ledger-1",
              direction: "DEBIT",
              amount: new Decimal(510),
              currency: "NGN",
              reference: "VTU-1",
              source: "VTU_PURCHASE",
              createdAt,
            },
          ],
        },
      },
      {
        id: "order-2",
        provider: "RELOADLY",
        providerRequestId: "REQ-2",
        providerTransactionId: null,
        providerStatus: null,
        scope: "INTERNATIONAL",
        serviceType: "DATA",
        countryCode: "GH",
        localProvider: null,
        operatorId: "100",
        amount: new Decimal(1000),
        currency: "NGN",
        costAmount: new Decimal(1000),
        fee: new Decimal(25),
        margin: new Decimal(25),
        status: "PROCESSING",
        targetMasked: "******5678",
        requeryAttempts: 0,
        lastRequeryAt: null,
        nextRequeryAt: null,
        completedAt: null,
        failedAt: null,
        createdAt,
        updatedAt: createdAt,
        transaction: {
          id: "tx-2",
          reference: "VTU-2",
          type: "DATA",
          amount: new Decimal(900),
          fee: new Decimal(25),
          currency: "NGN",
          status: "PENDING",
          createdAt,
          updatedAt: createdAt,
          ledgerEntries: [],
        },
      },
    ]);

    const report = await service.getVtuReconciliationReport(10, 50);

    expect(prisma.vtuOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        select: expect.objectContaining({
          transaction: expect.objectContaining({
            select: expect.objectContaining({
              ledgerEntries: expect.any(Object),
            }),
          }),
        }),
      }),
    );
    expect(report.summary).toEqual(
      expect.objectContaining({
        ordersReviewed: 2,
        totalOrderAmount: "1500",
        totalFees: "35",
        totalDebitAmount: "1535",
        amountMismatches: 1,
        feeMismatches: 1,
        missingDebitLedger: 1,
        staleOrders: 2,
      }),
    );
    expect(report.breakdowns.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "VTPASS",
          count: 1,
          totalAmount: "500",
          totalFees: "10",
          totalDebitAmount: "510",
        }),
      ]),
    );
    expect(report.exceptions.amountMismatches[0]).toEqual(
      expect.objectContaining({
        orderId: "order-2",
        orderAmount: "1000",
        transactionAmount: "900",
      }),
    );
    expect(report.exceptions.feeMismatches[0]).toEqual(
      expect.objectContaining({
        orderId: "order-1",
        orderFee: "10",
        transactionFee: "15",
      }),
    );
    expect(report.exceptions.missingDebitLedger[0]).toEqual(
      expect.objectContaining({
        orderId: "order-2",
        expectedDebitAmount: "1025",
      }),
    );
  });

  it("flags terminal failed VTU orders without reversal credit", async () => {
    const createdAt = new Date("2026-05-21T10:00:00.000Z");
    prisma.vtuOrder.findMany.mockResolvedValue([
      {
        id: "order-1",
        provider: "VTPASS",
        providerRequestId: "REQ-1",
        providerTransactionId: "PROV-TX-1",
        providerStatus: "failed",
        scope: "LOCAL",
        serviceType: "AIRTIME",
        countryCode: "NG",
        localProvider: "mtn",
        operatorId: null,
        amount: new Decimal(500),
        currency: "NGN",
        costAmount: new Decimal(500),
        fee: new Decimal(10),
        margin: new Decimal(10),
        status: "FAILED",
        targetMasked: "******1234",
        requeryAttempts: 1,
        lastRequeryAt: null,
        nextRequeryAt: null,
        completedAt: null,
        failedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        transaction: {
          id: "tx-1",
          reference: "VTU-1",
          type: "AIRTIME",
          amount: new Decimal(500),
          fee: new Decimal(10),
          currency: "NGN",
          status: "FAILED",
          createdAt,
          updatedAt: createdAt,
          ledgerEntries: [
            {
              id: "ledger-1",
              direction: "DEBIT",
              amount: new Decimal(510),
              currency: "NGN",
              reference: "VTU-1",
              source: "VTU_PURCHASE",
              createdAt,
            },
          ],
        },
      },
    ]);

    const report = await service.getVtuReconciliationReport();

    expect(report.summary.terminalWithoutReversalCredit).toBe(1);
    expect(report.exceptions.terminalWithoutReversalCredit[0]).toEqual(
      expect.objectContaining({
        orderId: "order-1",
        expectedReversalAmount: "510",
      }),
    );
  });

  it("manually requeries one VTU order and audits the admin action", async () => {
    const createdAt = new Date("2026-05-21T10:00:00.000Z");
    const before = {
      id: "order-1",
      provider: "VTPASS",
      providerRequestId: "REQ-1",
      providerTransactionId: null,
      providerStatus: "pending",
      status: "PENDING",
      amount: new Decimal(500),
      currency: "NGN",
      targetMasked: "******1234",
      requeryAttempts: 1,
      lastRequeryAt: null,
      nextRequeryAt: null,
      completedAt: null,
      failedAt: null,
      createdAt,
      updatedAt: createdAt,
      transaction: {
        id: "tx-1",
        reference: "VTU-1",
        status: "PENDING",
        amount: new Decimal(500),
        currency: "NGN",
        type: "AIRTIME",
        createdAt,
        updatedAt: createdAt,
      },
    };
    const after = {
      ...before,
      status: "PROCESSING",
      requeryAttempts: 2,
      updatedAt: new Date("2026-05-21T10:01:00.000Z"),
    };

    vtuService.findOrderForAdmin
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    vtuService.requeryOrder.mockResolvedValue({
      processed: true,
      status: "processing",
    });

    const result = await service.requeryVtuOrder(
      "VTU-1",
      { reason: "Manual provider status check" },
      "admin-1",
    );

    expect(vtuService.requeryOrder).toHaveBeenCalledWith("order-1");
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "VTU_ORDER_REQUERY",
        targetType: "VtuOrder",
        targetId: "order-1",
        reference: "VTU-1",
        reason: "Manual provider status check",
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        orderId: "order-1",
        reference: "VTU-1",
        order: after,
      }),
    );
  });

  it("returns a transaction drilldown payload and sanitizes nested metadata", async () => {
    const now = new Date("2026-05-28T10:00:00.000Z");
    prisma.transaction.findUnique.mockResolvedValue({
      id: "tx-1",
      reference: "TX-DRILL",
      type: "FUND",
      amount: new Decimal(1200),
      currency: "NGN",
      status: "SUCCESS",
      createdAt: now,
      updatedAt: now,
      metadata: {
        accountNumber: "1234567890",
        note: "approved",
      },
      user: {
        id: "user-1",
        email: "user@example.com",
        phone: "+2348012345678",
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
        createdAt: now,
      },
      wallet: {
        id: "wallet-1",
        currency: "NGN",
        balance: new Decimal(5000),
        updatedAt: now,
      },
      ledgerEntries: [
        {
          id: "entry-1",
          direction: "CREDIT",
          amount: new Decimal(1200),
          currency: "NGN",
          balanceBefore: new Decimal(3800),
          balanceAfter: new Decimal(5000),
          reference: "TX-DRILL",
          source: "FUNDING",
          metadata: {
            reference: "REF-1",
            secret: "should-hide",
          },
          createdAt: now,
        },
      ],
      transferAttempts: [],
      vtuOrders: [],
      exchangeReceipt: {
        id: "receipt-1",
        metadata: {
          providerTransactionId: "prov-1",
          token: "shh",
        },
      },
      disputes: [],
    });

    const result = await service.getTransactionDrilldown("TX-DRILL");

    expect(prisma.transaction.findUnique).toHaveBeenCalledWith({
      where: { reference: "TX-DRILL" },
      include: expect.objectContaining({
        user: expect.any(Object),
        wallet: expect.any(Object),
        ledgerEntries: expect.any(Object),
        transferAttempts: expect.any(Object),
        vtuOrders: expect.any(Object),
        exchangeReceipt: true,
        disputes: expect.any(Object),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        reference: "TX-DRILL",
        type: "FUND",
        metadata: {
          note: "approved",
        },
      }),
    );
    expect(result.ledgerEntries[0].metadata).toEqual({
      reference: "REF-1",
    });
    expect(result.exchangeReceipt?.metadata).toEqual({
      providerTransactionId: "prov-1",
    });
  });

  it("throws NotFoundException when transaction drilldown reference does not exist", async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);

    await expect(service.getTransactionDrilldown("MISSING")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("restricts withdrawal drilldown to withdrawals only", async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: "tx-2",
      reference: "TX-FUND",
      type: "FUND",
      amount: new Decimal(100),
      currency: "NGN",
      status: "SUCCESS",
      createdAt: new Date("2026-05-28T10:00:00.000Z"),
      updatedAt: new Date("2026-05-28T10:00:00.000Z"),
      metadata: null,
      user: null,
      wallet: null,
      ledgerEntries: [],
      transferAttempts: [],
      vtuOrders: [],
      exchangeReceipt: null,
      disputes: [],
    });

    await expect(service.getWithdrawalDrilldown("TX-FUND")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("builds a VTU reconciliation report with string money values and exception aliases", async () => {
    const oldDate = new Date("2020-01-01T10:00:00.000Z");
    prisma.vtuOrder.findMany.mockResolvedValue([
      {
        id: "order-1",
        provider: "VTPASS",
        providerRequestId: "REQ-1",
        providerTransactionId: null,
        providerStatus: "pending",
        scope: "LOCAL",
        serviceType: "AIRTIME",
        countryCode: "NG",
        localProvider: "mtn",
        operatorId: null,
        amount: new Decimal(500),
        currency: "NGN",
        costAmount: new Decimal(500),
        fee: new Decimal(25),
        margin: new Decimal(25),
        status: "PENDING",
        targetMasked: "******1234",
        requeryAttempts: 1,
        lastRequeryAt: null,
        nextRequeryAt: null,
        completedAt: null,
        failedAt: null,
        createdAt: oldDate,
        updatedAt: oldDate,
        transaction: {
          id: "tx-1",
          reference: "VTU-1",
          type: "AIRTIME",
          amount: new Decimal(500),
          fee: new Decimal(20),
          currency: "NGN",
          status: "PENDING",
          createdAt: oldDate,
          updatedAt: oldDate,
          ledgerEntries: [
            {
              id: "ledger-1",
              direction: "DEBIT",
              amount: new Decimal(525),
              currency: "NGN",
              reference: "VTU-1",
              source: "VTU_PURCHASE",
              createdAt: oldDate,
            },
          ],
        },
      },
    ]);

    const result = await service.getVtuReconciliationReport(10, 25);

    expect(prisma.vtuOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        orderBy: [{ createdAt: "desc" }],
      }),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        totalOrders: 1,
        totalAmount: "500",
        totalFees: "25",
        totalMargin: "25",
        feeMismatches: 1,
        staleOrders: 1,
        missingDebits: 0,
        missingReversals: 0,
      }),
    );
    expect(result.providerBreakdown[0]).toEqual(
      expect.objectContaining({
        provider: "VTPASS",
        count: 1,
        amount: "500",
        fees: "25",
        margin: "25",
      }),
    );
    expect(result.exceptions.feeMismatches[0]).toEqual(
      expect.objectContaining({
        orderId: "order-1",
        orderFee: "25",
        transactionFee: "20",
      }),
    );
    expect(result.exceptions.missingDebits).toEqual([]);
    expect(result.exceptions.missingReversals).toEqual([]);
  });

  it("creates a VTU pricing rule and audits the admin action", async () => {
    const createdAt = new Date("2026-05-21T10:00:00.000Z");
    prisma.vtuPricingRule.create.mockResolvedValue({
      id: "rule-1",
      countryCode: "NG",
      serviceType: "AIRTIME",
      provider: "mtn",
      scope: "LOCAL",
      fixedMargin: new Decimal(10),
      percentMargin: new Decimal(2.5),
      minAmount: new Decimal(100),
      maxAmount: new Decimal(1000),
      priority: 20,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await service.createVtuPricingRule(
      {
        countryCode: "NG",
        serviceType: "AIRTIME",
        provider: "mtn",
        scope: "LOCAL",
        fixedMargin: "10",
        percentMargin: "2.5",
        minAmount: "100",
        maxAmount: "1000",
        priority: 20,
        reason: "Configure MTN airtime retail margin",
      },
      "admin-1",
    );

    expect(prisma.vtuPricingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        countryCode: "NG",
        serviceType: "AIRTIME",
        provider: "mtn",
        scope: "LOCAL",
        fixedMargin: new Decimal(10),
        percentMargin: new Decimal(2.5),
        minAmount: new Decimal(100),
        maxAmount: new Decimal(1000),
        priority: 20,
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "VTU_PRICING_RULE_CREATE",
        targetType: "VtuPricingRule",
        targetId: "rule-1",
        reason: "Configure MTN airtime retail margin",
        after: expect.objectContaining({
          fixedMargin: "10",
          percentMargin: "2.5",
        }),
      }),
    });
    expect(result.id).toBe("rule-1");
  });

  it("deactivates a VTU pricing rule and records before and after snapshots", async () => {
    const createdAt = new Date("2026-05-21T10:00:00.000Z");
    const existing = {
      id: "rule-1",
      countryCode: "NG",
      serviceType: "AIRTIME",
      provider: "mtn",
      scope: "LOCAL",
      fixedMargin: new Decimal(10),
      percentMargin: new Decimal(2.5),
      minAmount: null,
      maxAmount: null,
      priority: 20,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    };
    prisma.vtuPricingRule.findUnique.mockResolvedValue(existing);
    prisma.vtuPricingRule.update.mockResolvedValue({
      ...existing,
      isActive: false,
      updatedAt: new Date("2026-05-21T10:01:00.000Z"),
    });

    await service.deactivateVtuPricingRule(
      "rule-1",
      { reason: "Disable outdated MTN airtime pricing" },
      "admin-1",
    );

    expect(prisma.vtuPricingRule.update).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: { isActive: false },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "VTU_PRICING_RULE_DEACTIVATE",
        targetType: "VtuPricingRule",
        targetId: "rule-1",
        before: expect.objectContaining({ isActive: true }),
        after: expect.objectContaining({ isActive: false }),
      }),
    });
  });

  it("replays a failed Monnify virtual-account deposit from its webhook log", async () => {
    prisma.webhookLog.findUnique.mockResolvedValue({
      id: "log-1",
      provider: "MONNIFY",
      reference: "MNF-REF-1",
      payload: {
        eventType: "SUCCESSFUL_TRANSACTION",
        eventData: {
          transactionReference: "MNF-REF-1",
          paymentStatus: "PAID",
          amountPaid: 2500,
          settlementAmount: 2481.25,
          currency: "NGN",
          destinationAccountInformation: { accountNumber: "6254727989" },
        },
      },
    });
    bankingService.processVirtualAccountDeposit.mockResolvedValue({
      received: true,
      processed: true,
    });
    prisma.webhookLog.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.replayVirtualAccountDeposit(
      "MNF-REF-1",
      { reason: "Deposit trapped after KYC lapse, user re-verified" },
      "admin-1",
    );

    expect(result).toEqual({ received: true, processed: true });
    expect(bankingService.processVirtualAccountDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "monnify",
        providerReference: "MNF-REF-1",
        accountNumber: "6254727989",
        amount: new Decimal(2500),
        settlementAmount: new Decimal(2481.25),
        currency: "NGN",
      }),
    );
    expect(prisma.webhookLog.update).toHaveBeenCalledWith({
      where: { reference: "MNF-REF-1" },
      data: { processed: true, errorMessage: null },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        action: "BANKING_DEPOSIT_REPLAY",
        targetType: "WebhookLog",
        targetId: "log-1",
      }),
    });
  });

  it("rejects replaying a webhook log that is not a paid virtual-account deposit", async () => {
    prisma.webhookLog.findUnique.mockResolvedValue({
      id: "log-2",
      provider: "MONNIFY",
      reference: "MNF-REF-2",
      payload: {
        eventType: "SUCCESSFUL_DISBURSEMENT",
        eventData: { transactionReference: "MNF-REF-2" },
      },
    });

    await expect(
      service.replayVirtualAccountDeposit(
        "MNF-REF-2",
        { reason: "Attempting to replay a disbursement event" },
        "admin-1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bankingService.processVirtualAccountDeposit).not.toHaveBeenCalled();

    prisma.webhookLog.findUnique.mockResolvedValue(null);

    await expect(
      service.replayVirtualAccountDeposit(
        "MISSING-REF",
        { reason: "No webhook log exists for this reference" },
        "admin-1",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
