import { BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { VtuService } from "./vtu.service";

describe("VtuService purchase ledger handling", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    vtuOrder: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    vtuPricingRule: {
      findFirst: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
    },
    webhookLog: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const walletsService = {
    getWallet: jest.fn(),
  };

  const vtuApi = {
    getProviders: jest.fn(),
    getPackages: jest.fn(),
    validateSmartCard: jest.fn(),
    validateMeter: jest.fn(),
    purchase: jest.fn(),
    requery: jest.fn(),
    getProviderName: jest.fn(),
    createProviderRequestId: jest.fn(),
  };

  const reloadly = {
    getOperators: jest.fn(),
    getUtilityBillers: jest.fn(),
    autoDetectOperator: jest.fn(),
    getTopupStatus: jest.fn(),
    purchase: jest.fn(),
    payUtilityBill: jest.fn(),
    requery: jest.fn(),
    requeryUtilityPayment: jest.fn(),
    assertReadyForPurchase: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const ledger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };
  const transactionPin = {
    verifyRequired: jest.fn(),
  };

  let service: VtuService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    vtuApi.getProviders.mockResolvedValue([
      { id: "mtn", name: "MTN", type: "airtime", isActive: true },
      { id: "mtn", name: "MTN", type: "data", isActive: true },
    ]);
    vtuApi.getPackages.mockResolvedValue([
      { id: "mtn-1gb", name: "1GB", price: 300, validity: "30 days" },
    ]);
    vtuApi.getProviderName.mockReturnValue("VTPASS");
    vtuApi.createProviderRequestId.mockImplementation(
      (reference: string) => `202605211500${reference.replace(/\W/g, "")}`,
    );
    prisma.vtuOrder.create.mockResolvedValue({
      id: "order-1",
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.vtuPricingRule.findFirst.mockResolvedValue(null);
    prisma.webhookLog.findUnique.mockResolvedValue({
      id: "webhook-log-1",
      reference: "reloadly:event-1",
      processed: false,
    });
    prisma.webhookLog.update.mockResolvedValue({});
    service = new VtuService(
      prisma,
      walletsService as any,
      vtuApi as any,
      reloadly as any,
      logger as any,
      ledger as any,
      transactionPin as any,
    );
  });

  it("creates a pending VTU transaction and debits wallet through the ledger", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "VTU-1",
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    vtuApi.purchase.mockResolvedValue({
      reference: "provider-vtu-1",
      status: "success",
      message: "Airtime delivered",
    });

    const result = await service.purchase("user-1", {
      type: "airtime",
      provider: "mtn",
      recipientNumber: "+2348012345678",
      amount: "500",
    });

    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        currency: "NGN",
        amount: expect.any(Decimal),
        transactionId: "tx-1",
        source: "VTU_PURCHASE",
        metadata: expect.objectContaining({
          vtuType: "airtime",
          provider: "mtn",
          recipientNumberMasked: expect.any(String),
        }),
      }),
      prisma,
    );
    expect(prisma.vtuOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: "tx-1",
        provider: "VTPASS",
        scope: "LOCAL",
        serviceType: "AIRTIME",
        countryCode: "NG",
        localProvider: "mtn",
        providerRequestId: expect.stringMatching(/^202605211500/),
        status: "PENDING",
        targetMasked: expect.any(String),
      }),
    });
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { reference: "VTU-1" },
      data: {
        status: "SUCCESS",
        metadata: expect.objectContaining({
          providerReference: "provider-vtu-1",
        }),
      },
    });
    expect(result.success).toBe(true);
    expect(result.orderId).toBe("order-1");
  });

  it("applies the highest-priority matching VTU pricing rule to wallet debit and transaction fee", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.vtuPricingRule.findFirst.mockResolvedValue({
      id: "rule-1",
      fixedMargin: new Decimal(10),
      percentMargin: new Decimal(2.5),
      createdAt: new Date(),
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "VTU-1",
    });
    vtuApi.purchase.mockResolvedValue({
      reference: "provider-vtu-1",
      status: "success",
      message: "Airtime delivered",
    });

    const result = await service.purchase("user-1", {
      type: "airtime",
      provider: "mtn",
      recipientNumber: "+2348012345678",
      amount: "500",
    });

    expect(prisma.vtuPricingRule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          AND: expect.arrayContaining([
            { OR: [{ countryCode: null }, { countryCode: "NG" }] },
            { OR: [{ serviceType: null }, { serviceType: "AIRTIME" }] },
            { OR: [{ provider: null }, { provider: "mtn" }] },
            { OR: [{ scope: null }, { scope: "LOCAL" }] },
          ]),
        }),
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      }),
    );
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: expect.any(Decimal),
        fee: expect.any(Decimal),
        metadata: expect.objectContaining({
          pricingRuleId: "rule-1",
          marginFee: "22.5",
          debitAmount: "522.5",
        }),
      }),
    });
    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: new Decimal("522.5"),
      }),
      prisma,
    );
    expect(prisma.vtuOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fee: new Decimal("22.5"),
        margin: new Decimal("22.5"),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        fee: "22.5",
        totalDebit: "522.5",
      }),
    );
  });

  it("loads international airtime operators from Reloadly", async () => {
    reloadly.getOperators.mockResolvedValue([
      { id: "342", name: "Airtel Nigeria", type: "airtime", isActive: true },
    ]);

    await expect(
      service.getProviders("airtime", "international", "NG"),
    ).resolves.toEqual([
      { id: "342", name: "Airtel Nigeria", type: "airtime", isActive: true },
    ]);
    expect(reloadly.getOperators).toHaveBeenCalledWith("NG", "airtime");
  });

  it("loads Ghana data operators from Reloadly", async () => {
    reloadly.getOperators.mockResolvedValue([
      { id: "200", name: "MTN Ghana Data", type: "data", isActive: true },
    ]);

    await expect(
      service.getProviders("data", "international", "GH"),
    ).resolves.toEqual([
      { id: "200", name: "MTN Ghana Data", type: "data", isActive: true },
    ]);
    expect(reloadly.getOperators).toHaveBeenCalledWith("GH", "data");
  });

  it("loads Ghana electricity billers from Reloadly utilities", async () => {
    reloadly.getUtilityBillers.mockResolvedValue([
      {
        id: "26",
        name: "ECG Ghana Prepaid",
        type: "electricity",
        isActive: true,
      },
    ]);

    await expect(
      service.getProviders("electricity", "international", "GH"),
    ).resolves.toEqual([
      {
        id: "26",
        name: "ECG Ghana Prepaid",
        type: "electricity",
        isActive: true,
      },
    ]);
    expect(reloadly.getUtilityBillers).toHaveBeenCalledWith(
      "GH",
      "electricity",
    );
  });

  it("auto-detects Reloadly operators by phone and country", async () => {
    reloadly.autoDetectOperator.mockResolvedValue({
      id: "342",
      name: "Airtel Nigeria",
      type: "airtime",
      isActive: true,
      countryCode: "NG",
    });

    await expect(
      service.autoDetectReloadlyOperator({
        phone: "+2348012345678",
        countryCode: "NG",
        type: "airtime",
      }),
    ).resolves.toEqual({
      id: "342",
      name: "Airtel Nigeria",
      type: "airtime",
      isActive: true,
      countryCode: "NG",
    });
    expect(reloadly.autoDetectOperator).toHaveBeenCalledWith({
      phone: "+2348012345678",
      countryCode: "NG",
      type: "airtime",
    });
  });

  it("looks up Reloadly top-up status by transaction id", async () => {
    reloadly.getTopupStatus.mockResolvedValue({
      reference: "12345",
      status: "success",
      message: "Delivered",
      providerRequestId: "VTU-REF-1",
    });

    await expect(service.getReloadlyTopupStatus("12345")).resolves.toEqual({
      reference: "12345",
      status: "success",
      message: "Delivered",
      providerRequestId: "VTU-REF-1",
    });
    expect(reloadly.getTopupStatus).toHaveBeenCalledWith("12345");
  });

  it("routes international airtime purchases through Reloadly", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "VTU-1",
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    reloadly.purchase.mockResolvedValue({
      reference: "reloadly-tx-1",
      status: "success",
      message: "International top-up delivered",
    });

    const result = await service.purchase("user-1", {
      scope: "international",
      type: "airtime",
      countryCode: "GH",
      operatorId: "123",
      recipientNumber: "+233501234567",
      amount: "500",
    });

    expect(vtuApi.purchase).not.toHaveBeenCalled();
    expect(reloadly.purchase).toHaveBeenCalledWith({
      type: "airtime",
      operatorId: "123",
      countryCode: "GH",
      recipientNumber: "+233501234567",
      amount: 500,
      reference: expect.stringContaining("VTU-"),
    });
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { reference: "VTU-1" },
      data: {
        status: "SUCCESS",
        metadata: expect.objectContaining({
          provider: "reloadly",
          countryCode: "GH",
          operatorId: "123",
          providerReference: "reloadly-tx-1",
        }),
      },
    });
    expect(result.success).toBe(true);
  });

  it("routes Ghana data purchases through Reloadly without requiring a VTpass package", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "VTU-1",
    });
    reloadly.purchase.mockResolvedValue({
      reference: "reloadly-data-1",
      status: "success",
      message: "International data delivered",
    });

    const result = await service.purchase("user-1", {
      scope: "international",
      type: "data",
      countryCode: "GH",
      operatorId: "200",
      recipientNumber: "+233501234567",
      amount: "500",
    });

    expect(vtuApi.getPackages).not.toHaveBeenCalled();
    expect(reloadly.purchase).toHaveBeenCalledWith({
      type: "data",
      operatorId: "200",
      countryCode: "GH",
      recipientNumber: "+233501234567",
      amount: 500,
      reference: expect.stringContaining("VTU-"),
    });
    expect(result.success).toBe(true);
  });

  it("routes Ghana electricity purchases through Reloadly utilities", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(10000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "VTU-1",
    });
    reloadly.payUtilityBill.mockResolvedValue({
      reference: "utility-tx-1",
      status: "success",
      message: "Electricity token delivered",
      providerRequestId: "VTU-1",
    });

    const result = await service.purchase("user-1", {
      scope: "international",
      type: "electricity",
      countryCode: "GH",
      operatorId: "26",
      meterNumber: "12345678901",
      amount: "1000",
    });

    expect(vtuApi.purchase).not.toHaveBeenCalled();
    expect(reloadly.payUtilityBill).toHaveBeenCalledWith({
      type: "electricity",
      billerId: "26",
      countryCode: "GH",
      meterNumber: "12345678901",
      amount: 1000,
      reference: expect.stringContaining("VTU-"),
    });
    expect(prisma.vtuOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: "RELOADLY",
        scope: "INTERNATIONAL",
        serviceType: "ELECTRICITY",
        countryCode: "GH",
        operatorId: "26",
        targetMasked: expect.any(String),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        status: "SUCCESS",
        message: "Electricity token delivered",
      }),
    );
  });

  it("rejects non-Ghana international electricity purchases", async () => {
    await expect(
      service.purchase("user-1", {
        scope: "international",
        type: "electricity",
        countryCode: "KE",
        operatorId: "26",
        meterNumber: "12345678901",
        amount: "1000",
      }),
    ).rejects.toThrow(
      "International electricity is currently available for Ghana only",
    );

    expect(walletsService.getWallet).not.toHaveBeenCalled();
    expect(reloadly.payUtilityBill).not.toHaveBeenCalled();
  });

  it("requires verified KYC before allowing VTU purchase", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      kycStatus: "PENDING",
      isSuspended: false,
    });

    await expect(
      service.purchase("user-1", {
        type: "airtime",
        provider: "mtn",
        recipientNumber: "+2348012345678",
        amount: "500",
      }),
    ).rejects.toThrow("KYC verification is required");

    expect(walletsService.getWallet).not.toHaveBeenCalled();
    expect(vtuApi.purchase).not.toHaveBeenCalled();
  });

  it("rejects data bundle purchases when client amount does not match provider package price", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });

    await expect(
      service.purchase("user-1", {
        type: "data",
        provider: "mtn",
        recipientNumber: "+2348012345678",
        amount: "1",
        packageId: "mtn-1gb",
      }),
    ).rejects.toThrow("Package price mismatch");

    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(ledger.debitWallet).not.toHaveBeenCalled();
    expect(vtuApi.purchase).not.toHaveBeenCalled();
  });

  it("leaves VTU purchase pending when provider result is unknown", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "VTU-1",
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    vtuApi.purchase.mockRejectedValue(new Error("VTU provider result unknown"));

    const result = await service.purchase("user-1", {
      type: "airtime",
      provider: "mtn",
      recipientNumber: "+2348012345678",
      amount: "500",
    });

    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { reference: "VTU-1" },
      data: {
        metadata: expect.objectContaining({
          providerStatus: "UNKNOWN",
        }),
      },
    });
    expect(result).toEqual({
      success: false,
      status: "PENDING",
      reference: "VTU-1",
      orderId: "order-1",
      message:
        "VTU purchase submitted and pending provider confirmation. Funds remain reserved until verification completes.",
      amount: "500",
      fee: "0",
      totalDebit: "500",
    });
  });

  it("leaves provider pending responses pending without reversing wallet", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "VTU-1",
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    vtuApi.purchase.mockResolvedValue({
      reference: "provider-vtu-1",
      status: "pending",
      message: "TRANSACTION IS PROCESSING",
    });

    const result = await service.purchase("user-1", {
      type: "airtime",
      provider: "mtn",
      recipientNumber: "+2348012345678",
      amount: "500",
    });

    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { reference: "VTU-1" },
      data: {
        metadata: expect.objectContaining({
          providerReference: "provider-vtu-1",
          providerStatus: "pending",
        }),
      },
    });
    expect(result).toEqual({
      success: false,
      status: "PENDING",
      reference: "VTU-1",
      orderId: "order-1",
      message: "TRANSACTION IS PROCESSING",
      amount: "500",
      fee: "0",
      totalDebit: "500",
    });
  });

  it("requeries stale pending VTU orders and finalizes success", async () => {
    prisma.vtuOrder.findUnique.mockResolvedValue({
      id: "order-1",
      transactionId: "tx-1",
      provider: "VTPASS",
      providerRequestId: "202605211500VTU1",
      providerTransactionId: null,
      status: "PENDING",
      transaction: {
        id: "tx-1",
        userId: "user-1",
        reference: "VTU-1",
        amount: new Decimal(500),
        fee: new Decimal(0),
        currency: "NGN",
        status: "PENDING",
      },
    });
    vtuApi.requery.mockResolvedValue({
      reference: "provider-vtu-1",
      status: "success",
      message: "Delivered",
    });

    const result = await service.requeryOrder("order-1");

    expect(vtuApi.requery).toHaveBeenCalledWith("202605211500VTU1");
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", status: "PENDING" },
      data: {
        status: "SUCCESS",
        metadata: expect.objectContaining({
          providerReference: "provider-vtu-1",
          providerStatus: "success",
        }),
      },
    });
    expect(prisma.vtuOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        providerTransactionId: "provider-vtu-1",
        providerStatus: "success",
        nextRequeryAt: null,
      }),
    });
    expect(result).toEqual({ processed: true, status: "success" });
  });

  it("requeries Reloadly utility orders by internal reference id", async () => {
    prisma.vtuOrder.findUnique.mockResolvedValue({
      id: "order-1",
      transactionId: "tx-1",
      provider: "RELOADLY",
      providerRequestId: "VTU-1",
      providerTransactionId: "utility-tx-1",
      serviceType: "ELECTRICITY",
      status: "PENDING",
      transaction: {
        id: "tx-1",
        userId: "user-1",
        reference: "VTU-1",
        amount: new Decimal(1000),
        fee: new Decimal(0),
        currency: "NGN",
        status: "PENDING",
      },
    });
    reloadly.requeryUtilityPayment.mockResolvedValue({
      reference: "utility-tx-1",
      status: "success",
      message: "Token delivered",
      providerRequestId: "VTU-1",
    });

    const result = await service.requeryOrder("order-1");

    expect(reloadly.requeryUtilityPayment).toHaveBeenCalledWith("VTU-1");
    expect(reloadly.requery).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: true, status: "success" });
  });

  it("reverses a failed VTU purchase through a single reversal ledger entry", async () => {
    walletsService.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "VTU-1",
    });
    vtuApi.purchase.mockResolvedValue({
      reference: "provider-vtu-1",
      status: "failed",
      message: "Provider rejected request",
    });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await expect(
      service.purchase("user-1", {
        type: "data",
        provider: "mtn",
        recipientNumber: "+2348012345678",
        amount: "300",
        packageId: "mtn-1gb",
      }),
    ).rejects.toThrow(BadRequestException);

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        currency: "NGN",
        amount: expect.any(Decimal),
        transactionId: "tx-1",
        reference: "VTU-1-REVERSAL",
        source: "VTU_REVERSAL",
      }),
      prisma,
    );
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { reference: "VTU-1" },
      data: {
        status: "FAILED",
        metadata: expect.objectContaining({
          reversalReason: "Provider rejected request",
        }),
      },
    });
  });

  it("stores Reloadly webhook events idempotently in webhook logs", async () => {
    prisma.webhookLog.create.mockResolvedValue({
      id: "webhook-log-1",
      reference: "reloadly:event-1",
    });

    await expect(
      service.recordReloadlyWebhookEvent({
        eventId: "event-1",
        eventType: "topup.status",
        providerReference: "reloadly-tx-1",
        providerRequestId: "VTU-1",
        status: "successful",
        rawPayload: { id: "event-1" },
      }),
    ).resolves.toEqual({
      duplicate: false,
      logId: "webhook-log-1",
      reference: "reloadly:event-1",
    });

    expect(prisma.webhookLog.create).toHaveBeenCalledWith({
      data: {
        provider: "reloadly",
        eventType: "topup.status",
        reference: "reloadly:event-1",
        payload: { id: "event-1" },
        processed: false,
      },
      select: { id: true, reference: true },
    });
  });

  it("finalizes a Reloadly webhook success through the existing VTU order path", async () => {
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: "order-1",
      transactionId: "tx-1",
      provider: "RELOADLY",
      providerRequestId: "VTU-1",
      providerTransactionId: "reloadly-tx-1",
      status: "PROCESSING",
      transaction: {
        id: "tx-1",
        userId: "user-1",
        reference: "VTU-1",
        amount: new Decimal(500),
        fee: new Decimal(10),
        currency: "NGN",
        status: "PENDING",
      },
    });

    await expect(
      service.processReloadlyWebhookEvent({
        eventId: "event-1",
        eventType: "topup.status",
        providerReference: "reloadly-tx-1",
        providerRequestId: "VTU-1",
        status: "successful",
        rawPayload: { id: "event-1", status: "SUCCESSFUL" },
      }),
    ).resolves.toEqual({
      processed: true,
      orderId: "order-1",
      status: "successful",
    });

    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", status: "PENDING" },
      data: {
        status: "SUCCESS",
        metadata: expect.objectContaining({
          providerReference: "reloadly-tx-1",
          providerStatus: "successful",
          providerRequestId: "VTU-1",
        }),
      },
    });
    expect(prisma.vtuOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        providerTransactionId: "reloadly-tx-1",
        providerStatus: "successful",
        nextRequeryAt: null,
      }),
    });
    expect(prisma.webhookLog.update).toHaveBeenCalledWith({
      where: { reference: "reloadly:event-1" },
      data: { processed: true, errorMessage: undefined },
    });
  });

  it("refunds a Reloadly refunded webhook exactly once through VTU reversal logic", async () => {
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: "order-1",
      transactionId: "tx-1",
      provider: "RELOADLY",
      providerRequestId: "VTU-1",
      providerTransactionId: "reloadly-tx-1",
      status: "SUCCESS",
      transaction: {
        id: "tx-1",
        userId: "user-1",
        reference: "VTU-1",
        amount: new Decimal(500),
        fee: new Decimal(10),
        currency: "NGN",
        status: "SUCCESS",
      },
    });
    prisma.ledgerEntry.findFirst.mockResolvedValue({
      id: "reversal-ledger-1",
    });

    await service.processReloadlyWebhookEvent({
      eventId: "event-1",
      eventType: "topup.status",
      providerReference: "reloadly-tx-1",
      providerRequestId: "VTU-1",
      status: "refunded",
      message: "Provider refunded top-up",
      rawPayload: { id: "event-1", status: "REFUNDED" },
    });

    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { reference: "VTU-1" },
      data: {
        status: "REVERSED",
        metadata: expect.objectContaining({
          providerReference: "reloadly-tx-1",
          providerStatus: "refunded",
          reversalReason: "Provider refunded top-up",
        }),
      },
    });
    expect(prisma.vtuOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: expect.objectContaining({
        status: "REVERSED",
        providerTransactionId: "reloadly-tx-1",
        providerStatus: "refunded",
        nextRequeryAt: null,
      }),
    });
  });
});
