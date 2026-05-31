import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { ExchangeService } from "./exchange.service";
import { PrismaService } from "../prisma/prisma.service";
import { RateService } from "./providers/rate.service";
import { RedisService } from "../redis/redis.service";
import { PinoLogger } from "nestjs-pino";
import { LedgerService } from "../wallets/ledger.service";
import { Decimal } from "@prisma/client/runtime/library";
import { TransactionPinService } from "../common/services/transaction-pin.service";
import { Prisma } from "@prisma/client";
import { BankingService } from "../banking/banking.service";

describe("ExchangeService", () => {
  let service: ExchangeService;

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };

  const mockPrisma = {
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
    user: {
      findUnique: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
    },
    exchangeReceipt: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    providerEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockLedger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };

  const mockTransactionPin = {
    verifyRequired: jest.fn(),
  };

  const mockBankingService = {
    getVirtualAccounts: jest.fn(),
  };

  const mockRateService = {
    getRate: jest.fn().mockResolvedValue({ rate: 3.1746, markup: 2.5 }),
  };

  const mockPinoLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: any) =>
      fn(mockPrisma),
    );
    mockRateService.getRate.mockResolvedValue({ rate: 3.1746, markup: 2.5 });

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({ JWT_EXPIRES_IN: "15m", JWT_REFRESH_EXPIRES_IN: "7d" }),
          ],
        }),
      ],
      providers: [
        ExchangeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RateService, useValue: mockRateService },
        { provide: RedisService, useValue: mockRedis },
        { provide: PinoLogger, useValue: mockPinoLogger },
        { provide: LedgerService, useValue: mockLedger },
        { provide: TransactionPinService, useValue: mockTransactionPin },
        { provide: BankingService, useValue: mockBankingService },
      ],
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createQuote", () => {
    it("should throw error if from and to currencies are the same", async () => {
      await expect(
        service.createQuote("user-1", {
          from: "GHS",
          to: "GHS",
          amount: "100",
        }),
      ).rejects.toThrow("Source and destination currencies must be different");
    });

    it("should create a quote and store in Redis", async () => {
      const quote = await service.createQuote("user-1", {
        from: "GHS",
        to: "NGN",
        amount: "100",
      });

      expect(quote.id).toBeDefined();
      expect(quote.userId).toBe("user-1");
      expect(quote.from).toBe("GHS");
      expect(quote.to).toBe("NGN");
      expect(quote.amount).toBe("100.00");
      expect(quote.rate).toBeGreaterThan(0);
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  describe("executeQuote", () => {
    it("posts exchange debit and credit through the ledger in one transaction", async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          id: "quote-1",
          userId: "user-1",
          from: "NGN",
          to: "GHS",
          amount: "100.00",
          rate: 0.1,
          markupPercent: 2.5,
          fee: "2.00",
          sendAmount: "102.00",
          receiveAmount: "10.00",
          expiresAt,
          createdAt: new Date(),
        }),
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
      });
      mockPrisma.wallet.findUnique
        .mockResolvedValueOnce({
          id: "wallet-ngn",
        })
        .mockResolvedValueOnce({
          id: "wallet-ghs",
        });
      mockPrisma.wallet.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.wallet.update.mockResolvedValue({
        id: "wallet-ghs",
        balance: new Decimal(60),
        currency: "GHS",
      });
      mockPrisma.wallet.findUniqueOrThrow.mockResolvedValue({
        id: "wallet-ngn",
        balance: new Decimal(898),
        currency: "NGN",
      });
      mockPrisma.transaction.create.mockResolvedValue({
        id: "tx-1",
        reference: "EXC-1",
        type: "EXCHANGE",
        amount: new Decimal(100),
        fee: new Decimal(2),
        currency: "NGN",
        status: "SUCCESS",
        createdAt: new Date(),
      });
      mockLedger.debitWallet.mockResolvedValue({
        walletId: "wallet-ngn",
        balanceAfter: new Decimal(898),
      });
      mockLedger.creditWallet.mockResolvedValue({
        walletId: "wallet-ghs",
        balanceAfter: new Decimal(60),
      });

      await service.executeQuote("user-1", { quoteId: "quote-1" });

      expect(mockLedger.debitWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          currency: "NGN",
          amount: new Decimal(102),
          transactionId: "tx-1",
          source: "EXCHANGE_DEBIT",
        }),
        mockPrisma,
      );
      expect(mockLedger.creditWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          currency: "GHS",
          amount: new Decimal(10),
          transactionId: "tx-1",
          source: "EXCHANGE_CREDIT",
        }),
        mockPrisma,
      );
    });

    it("requires tier 2 KYC before executing an exchange", async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          id: "quote-1",
          userId: "user-1",
          from: "NGN",
          to: "GHS",
          amount: "100.00",
          rate: 0.1,
          markupPercent: 2.5,
          fee: "2.00",
          sendAmount: "102.00",
          receiveAmount: "10.00",
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
        }),
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        kycStatus: "VERIFIED",
        kycTier: "TIER_1",
        isSuspended: false,
      });

      await expect(
        service.executeQuote("user-1", { quoteId: "quote-1" }),
      ).rejects.toThrow("KYC Tier 2 is required to execute an exchange");
      expect(mockPrisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(mockLedger.debitWallet).not.toHaveBeenCalled();
    });
  });

  describe("manual exchange receipts", () => {
    const buildManualReceipt = (overrides: Record<string, any> = {}) => ({
      id: "receipt-1",
      userId: "user-1",
      transactionId: "tx-1",
      sourceCurrency: "NGN",
      targetCurrency: "GHS",
      amount: new Decimal(1000),
      expectedCreditAmount: new Decimal("3255.46"),
      rate: new Decimal("3.255465"),
      markupPercent: new Decimal("2.50"),
      bankReference: "BANKREF123",
      senderName: "Ada Lovelace",
      senderBankName: "Test Bank",
      receiptUrl: "https://example.com/receipt.png",
      status: "SUBMITTED",
      adminId: null,
      reviewReason: null,
      creditedAt: null,
      reviewedAt: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: "user-1",
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
      },
      transaction: {
        id: "tx-1",
        reference: "MXR-1",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      ...overrides,
    });

    it("submits a verified user's NGN receipt as a pending exchange transaction", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
        wallets: [{ id: "wallet-ghs" }],
      });
      mockPrisma.transaction.create.mockResolvedValue({
        id: "tx-1",
        reference: "MXR-1",
        status: "PENDING",
      });
      mockPrisma.exchangeReceipt.create.mockResolvedValue({
        id: "receipt-1",
        userId: "user-1",
        transactionId: "tx-1",
        sourceCurrency: "NGN",
        targetCurrency: "GHS",
        amount: new Decimal(1000),
        expectedCreditAmount: new Decimal("3255.46"),
        rate: new Decimal("3.255465"),
        markupPercent: new Decimal("2.50"),
        bankReference: "BANKREF123",
        senderName: "Ada Lovelace",
        senderBankName: "Test Bank",
        receiptUrl: "https://example.com/receipt.png",
        status: "SUBMITTED",
        adminId: null,
        reviewReason: null,
        creditedAt: null,
        reviewedAt: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        transaction: {
          reference: "MXR-1",
          status: "PENDING",
        },
      });

      await service.submitManualReceipt("user-1", {
        amount: "1000",
        bankReference: "BANKREF123",
        senderName: "Ada Lovelace",
        senderBankName: "Test Bank",
        receiptUrl: "https://example.com/receipt.png",
      });

      expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            type: "EXCHANGE",
            currency: "NGN",
            status: "PENDING",
          }),
        }),
      );
      expect(mockPrisma.exchangeReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            targetCurrency: "GHS",
            bankReference: "BANKREF123",
          }),
        }),
      );
    });

    it("creates a Monnify verified exchange deposit intent without crediting a wallet", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
        wallets: [{ id: "wallet-ghs" }],
      });
      mockBankingService.getVirtualAccounts.mockResolvedValue([
        {
          provider: "MONNIFY",
          currency: "NGN",
          accountNumberMasked: "******7989",
          accountName: "TRUSTPAY ADA",
          bankName: "Moniepoint Microfinance Bank",
          status: "ACTIVE",
        },
      ]);
      mockPrisma.transaction.create.mockResolvedValue({
        id: "tx-1",
        reference: "MXD-1",
        status: "PENDING",
      });
      mockPrisma.exchangeReceipt.create.mockResolvedValue({
        ...buildManualReceipt({
          id: "receipt-1",
          bankReference: "MXD-1",
          receiptUrl: "monnify://pending/MXD-1",
          metadata: {
            flow: "MONNIFY_VERIFIED_EXCHANGE_DEPOSIT",
            providerVerificationStatus: "PENDING",
          },
          transaction: {
            reference: "MXD-1",
            status: "PENDING",
          },
        }),
      });

      await service.createMonnifyExchangeDepositIntent("user-1", {
        amount: "1000",
      });

      expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "EXCHANGE",
            status: "PENDING",
            metadata: expect.objectContaining({
              flow: "MONNIFY_VERIFIED_EXCHANGE_DEPOSIT",
              providerVerificationStatus: "PENDING",
            }),
          }),
        }),
      );
      expect(mockPrisma.exchangeReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            receiptUrl: expect.stringContaining("monnify://pending/"),
            metadata: expect.objectContaining({
              flow: "MONNIFY_VERIFIED_EXCHANGE_DEPOSIT",
              providerVerificationStatus: "PENDING",
            }),
          }),
        }),
      );
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
    });

    it("marks a Monnify exchange deposit as provider verified without crediting GHS", async () => {
      const receipt = buildManualReceipt({
        bankReference: "monnify-tx-1",
        amount: new Decimal(1000),
        metadata: {
          flow: "MONNIFY_VERIFIED_EXCHANGE_DEPOSIT",
          providerVerificationStatus: "PENDING",
        },
      });

      mockPrisma.providerEvent.findUnique.mockResolvedValue(null);
      mockPrisma.providerEvent.create.mockResolvedValue({
        id: "provider-event-1",
        status: "PROCESSING",
      });
      mockPrisma.exchangeReceipt.findMany.mockResolvedValue([receipt]);
      mockPrisma.exchangeReceipt.update.mockResolvedValue({});
      mockPrisma.transaction.update.mockResolvedValue({});
      mockPrisma.providerEvent.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.processMonnifyExchangeDepositWebhook({
        eventType: "SUCCESSFUL_TRANSACTION",
        providerReference: "monnify-tx-1",
        paymentReference: "MXD-REF",
        accountNumber: "",
        amount: new Decimal(1000),
        currency: "NGN",
        rawPayload: {
          eventData: {
            paymentReference: "MXD-REF",
            transactionReference: "monnify-tx-1",
          },
        },
      });

      expect(result).toEqual({
        matched: true,
        processed: true,
        receiptId: "receipt-1",
      });
      expect(mockPrisma.exchangeReceipt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "receipt-1" },
          data: expect.objectContaining({
            status: "APPROVED",
            receiptUrl: "monnify://transaction/monnify-tx-1",
          }),
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "MONNIFY_EXCHANGE_DEPOSIT_VERIFIED",
          }),
        }),
      );
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
    });

    it("returns a duplicate response for an already-processed Monnify webhook", async () => {
      mockPrisma.providerEvent.findUnique.mockResolvedValue({
        id: "provider-event-1",
        provider: "MONNIFY",
        eventType: "SUCCESSFUL_TRANSACTION",
        providerReference: "monnify-tx-1",
        status: "PROCESSED",
      });

      const result = await service.processMonnifyExchangeDepositWebhook({
        eventType: "SUCCESSFUL_TRANSACTION",
        providerReference: "monnify-tx-1",
        paymentReference: "MXD-REF",
        accountNumber: "",
        amount: new Decimal(1000),
        currency: "NGN",
        rawPayload: {
          eventData: {
            paymentReference: "MXD-REF",
            transactionReference: "monnify-tx-1",
          },
        },
      });

      expect(result).toEqual({
        matched: true,
        processed: false,
        duplicate: true,
      });
      expect(mockPrisma.exchangeReceipt.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.exchangeReceipt.update).not.toHaveBeenCalled();
      expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it("requires Monnify verification before crediting a Monnify exchange deposit", async () => {
      const receipt = buildManualReceipt({
        status: "SUBMITTED",
        metadata: {
          flow: "MONNIFY_VERIFIED_EXCHANGE_DEPOSIT",
          providerVerificationStatus: "PENDING",
        },
      });

      mockPrisma.exchangeReceipt.findUnique
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(receipt);

      await expect(
        service.reviewManualReceipt("receipt-1", "admin-1", {
          status: "APPROVED",
          reason: "Credit after Monnify verification",
        }),
      ).rejects.toThrow(
        "Monnify verification is required before crediting this exchange",
      );
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
    });

    it("credits the GHS wallet once when an admin approves a receipt", async () => {
      const receipt = {
        id: "receipt-1",
        userId: "user-1",
        transactionId: "tx-1",
        sourceCurrency: "NGN",
        targetCurrency: "GHS",
        amount: new Decimal(1000),
        expectedCreditAmount: new Decimal("3255.46"),
        rate: new Decimal("3.255465"),
        markupPercent: new Decimal("2.50"),
        bankReference: "BANKREF123",
        senderName: "Ada Lovelace",
        senderBankName: "Test Bank",
        receiptUrl: "https://example.com/receipt.png",
        status: "SUBMITTED",
        adminId: null,
        reviewReason: null,
        creditedAt: null,
        reviewedAt: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: "user-1",
          kycStatus: "VERIFIED",
          kycTier: "TIER_2",
          isSuspended: false,
        },
        transaction: {
          id: "tx-1",
          reference: "MXR-1",
          status: "PENDING",
        },
      };

      mockPrisma.exchangeReceipt.findUnique
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce({
          ...receipt,
          status: "CREDITED",
          transaction: {
            id: "tx-1",
            reference: "MXR-1",
            status: "SUCCESS",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      mockPrisma.exchangeReceipt.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.update.mockResolvedValue({
        id: "tx-1",
        status: "SUCCESS",
      });
      mockLedger.creditWallet.mockResolvedValue({
        walletId: "wallet-ghs",
        balanceAfter: new Decimal("3255.46"),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.reviewManualReceipt("receipt-1", "admin-1", {
        status: "APPROVED",
        reason: "Matched bank statement reference",
      });

      expect(mockLedger.creditWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          currency: "GHS",
          amount: new Decimal("3255.46"),
          transactionId: "tx-1",
          source: "MANUAL_EXCHANGE_RECEIPT_CREDIT",
        }),
        mockPrisma,
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: "admin-1",
            action: "MANUAL_EXCHANGE_RECEIPT_CREDIT",
          }),
        }),
      );
    });

    it("requires Tier 2 KYC before submitting a manual exchange receipt", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        kycStatus: "VERIFIED",
        kycTier: "TIER_1",
        isSuspended: false,
        wallets: [{ id: "wallet-ghs" }],
      });

      await expect(
        service.submitManualReceipt("user-1", {
          amount: "1000",
          bankReference: "BANKREF123",
          senderName: "Ada Lovelace",
          senderBankName: "Test Bank",
          receiptUrl: "https://example.com/receipt.png",
        }),
      ).rejects.toThrow("KYC Tier 2 is required to submit an exchange receipt");
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
      expect(mockPrisma.exchangeReceipt.create).not.toHaveBeenCalled();
    });

    it("requires Tier 2 KYC before an approved receipt can be credited", async () => {
      const receipt = {
        id: "receipt-1",
        userId: "user-1",
        transactionId: "tx-1",
        sourceCurrency: "NGN",
        targetCurrency: "GHS",
        amount: new Decimal(1000),
        expectedCreditAmount: new Decimal("3255.46"),
        rate: new Decimal("3.255465"),
        markupPercent: new Decimal("2.50"),
        bankReference: "BANKREF123",
        senderName: "Ada Lovelace",
        senderBankName: "Test Bank",
        receiptUrl: "https://example.com/receipt.png",
        status: "SUBMITTED",
        adminId: null,
        reviewReason: null,
        creditedAt: null,
        reviewedAt: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: "user-1",
          kycStatus: "VERIFIED",
          kycTier: "TIER_1",
          isSuspended: false,
        },
        transaction: {
          id: "tx-1",
          reference: "MXR-1",
          status: "PENDING",
        },
      };

      mockPrisma.exchangeReceipt.findUnique.mockResolvedValue(receipt);

      await expect(
        service.reviewManualReceipt("receipt-1", "admin-1", {
          status: "APPROVED",
          reason: "Matched bank statement reference",
        }),
      ).rejects.toThrow("KYC Tier 2 is required to review an exchange receipt");
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it("rejects duplicate approval if the receipt was terminally reviewed during the approval transaction", async () => {
      const receipt = buildManualReceipt();

      mockPrisma.exchangeReceipt.findUnique
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(receipt);
      mockPrisma.exchangeReceipt.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reviewManualReceipt("receipt-1", "admin-1", {
          status: "APPROVED",
          reason: "Matched bank statement reference",
        }),
      ).rejects.toThrow("Receipt was already reviewed");

      expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it("rejects approval when the linked transaction is not pending review", async () => {
      const receipt = buildManualReceipt({
        transaction: {
          id: "tx-1",
          reference: "MXR-1",
          status: "SUCCESS",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      mockPrisma.exchangeReceipt.findUnique
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(receipt);

      await expect(
        service.reviewManualReceipt("receipt-1", "admin-1", {
          status: "APPROVED",
          reason: "Matched bank statement reference",
        }),
      ).rejects.toThrow("Receipt transaction is not pending review");

      expect(mockPrisma.exchangeReceipt.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it("marks a rejected receipt failed without crediting the GHS wallet", async () => {
      const reviewedAt = new Date();
      const receipt = buildManualReceipt();
      const rejectedReceipt = buildManualReceipt({
        status: "REJECTED",
        adminId: "admin-1",
        reviewReason: "Bank statement reference was not found",
        reviewedAt,
        transaction: {
          id: "tx-1",
          reference: "MXR-1",
          status: "FAILED",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      mockPrisma.exchangeReceipt.findUnique
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(rejectedReceipt);
      mockPrisma.exchangeReceipt.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.update.mockResolvedValue({
        id: "tx-1",
        status: "FAILED",
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.reviewManualReceipt("receipt-1", "admin-1", {
        status: "REJECTED",
        reason: "Bank statement reference was not found",
      });

      expect(mockPrisma.exchangeReceipt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "REJECTED",
            adminId: "admin-1",
            reviewReason: "Bank statement reference was not found",
          }),
        }),
      );
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
        where: { id: "tx-1" },
        data: { status: "FAILED" },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: "admin-1",
            action: "MANUAL_EXCHANGE_RECEIPT_REJECTED",
            after: {
              status: "REJECTED",
              transactionStatus: "FAILED",
            },
          }),
        }),
      );
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
      expect(result?.status).toBe("REJECTED");
      expect(result?.transaction).toEqual(
        expect.objectContaining({ status: "FAILED" }),
      );
    });

    it("marks a receipt as needing more information without crediting or failing the transaction", async () => {
      const reviewedAt = new Date();
      const receipt = buildManualReceipt();
      const needsInfoReceipt = buildManualReceipt({
        status: "NEEDS_MORE_INFO",
        adminId: "admin-1",
        reviewReason: "Receipt image does not show the bank reference",
        reviewedAt,
      });

      mockPrisma.exchangeReceipt.findUnique
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(needsInfoReceipt);
      mockPrisma.exchangeReceipt.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.update.mockResolvedValue({
        id: "tx-1",
        status: "PENDING",
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.reviewManualReceipt("receipt-1", "admin-1", {
        status: "NEEDS_MORE_INFO",
        reason: "Receipt image does not show the bank reference",
      });

      expect(mockPrisma.exchangeReceipt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "NEEDS_MORE_INFO",
            adminId: "admin-1",
            reviewReason: "Receipt image does not show the bank reference",
          }),
        }),
      );
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
        where: { id: "tx-1" },
        data: { status: "PENDING" },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: "admin-1",
            action: "MANUAL_EXCHANGE_RECEIPT_NEEDS_MORE_INFO",
            after: {
              status: "NEEDS_MORE_INFO",
              transactionStatus: "PENDING",
            },
          }),
        }),
      );
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
      expect(result?.status).toBe("NEEDS_MORE_INFO");
      expect(result?.transaction).toEqual(
        expect.objectContaining({ status: "PENDING" }),
      );
    });

    it("maps duplicate bank references on receipt submission to a safe bad request", async () => {
      const duplicateBankReferenceError =
        new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed on the fields: (`bankReference`)",
          {
            code: "P2002",
            clientVersion: "6.17.0",
            meta: { target: ["bankReference"] },
          },
        );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
        wallets: [{ id: "wallet-ghs" }],
      });
      mockPrisma.transaction.create.mockResolvedValue({
        id: "tx-1",
        reference: "MXR-1",
        status: "PENDING",
      });
      mockPrisma.exchangeReceipt.create.mockRejectedValue(
        duplicateBankReferenceError,
      );

      await expect(
        service.submitManualReceipt("user-1", {
          amount: "1000",
          bankReference: "BANKREF123",
          senderName: "Ada Lovelace",
          senderBankName: "Test Bank",
          receiptUrl: "https://example.com/receipt.png",
        }),
      ).rejects.toThrow("Receipt reference has already been submitted");
    });

    it("requires a GHS wallet before submitting a manual exchange receipt", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
        wallets: [],
      });

      await expect(
        service.submitManualReceipt("user-1", {
          amount: "1000",
          bankReference: "BANKREF123",
          senderName: "Ada Lovelace",
          senderBankName: "Test Bank",
          receiptUrl: "https://example.com/receipt.png",
        }),
      ).rejects.toThrow("GHS wallet not found");

      expect(mockRateService.getRate).not.toHaveBeenCalled();
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
      expect(mockPrisma.exchangeReceipt.create).not.toHaveBeenCalled();
    });
  });
});
