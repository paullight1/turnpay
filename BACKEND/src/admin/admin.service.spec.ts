import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { AdminService } from "./admin.service";

describe("AdminService banking operations", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    transaction: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    transferAttempt: {
      update: jest.fn(),
    },
    vtuOrder: {
      findMany: jest.fn(),
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
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
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

  const supabase = {
    setAuthAppRole: jest.fn(),
  };

  const vtuService = {
    findOrderForAdmin: jest.fn(),
    requeryOrder: jest.fn(),
    getProviderHealth: jest.fn(),
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
      supabase as any,
      vtuService as any,
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
});
