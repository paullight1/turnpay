import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  CanActivate,
} from "@nestjs/common";
import * as request from "supertest";
import { createHash } from "crypto";

import { ExchangeController, AdminExchangeController } from "../src/exchange/exchange.controller";
import { ExchangeService } from "../src/exchange/exchange.service";
import { RateService } from "../src/exchange/providers/rate.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { SupabaseService } from "../src/supabase/supabase.service";
import { LedgerService } from "../src/wallets/ledger.service";
import { TransactionPinService } from "../src/common/services/transaction-pin.service";
import { BankingService } from "../src/banking/banking.service";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard";
import { IdempotencyInterceptor } from "../src/common/interceptors/idempotency.interceptor";
import { PinoLogger } from "nestjs-pino";
import { ConfigModule } from "@nestjs/config";
import { Decimal } from "@prisma/client/runtime/library";

// ========================================================================
// Mocks
// ========================================================================

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  setIfNotExists: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  isAvailable: jest.fn(),
};

const mockPrisma = {
  $transaction: jest.fn(),
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  transaction: {
    create: jest.fn(),
    update: jest.fn(),
  },
  exchangeReceipt: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  idempotencyRecord: {
    findUnique: jest.fn(),
    create: jest.fn(),
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

const mockSupabaseService: Record<string, jest.Mock> = {
  verifyToken: jest.fn(),
  syncUser: jest.fn(),
  createSignedUploadUrl: jest.fn(),
  createSignedReadUrl: jest.fn(),
};

const mockBankingService = {
  getVirtualAccounts: jest.fn(),
};

const mockRateService = {
  getRate: jest.fn(),
};

const mockPinoLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
};

// ========================================================================
// Mock JwtAuthGuard — reads user identity from test-specific headers so we
// never hit real Supabase.
// ========================================================================

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = {
      userId: req.headers["x-test-user-id"] || "test-user",
      email: req.headers["x-test-email"] || "test@trustpay.com",
      role: req.headers["x-test-user-role"] || "USER",
    };
    return true;
  }
}

// ========================================================================
// Helpers
// ========================================================================

/** SHA-256 hex digest — matches what IdempotencyInterceptor uses. */
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value ?? {}))
    .digest("hex");

/**
 * Build a fake receipt as it would be returned from Prisma (Decimal fields +
 * nested user + transaction).  `overrides` can replace any field.
 */
function buildPrismaReceipt(overrides: Record<string, any> = {}) {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    transactionId: "33333333-3333-4333-8333-333333333333",
    sourceCurrency: "NGN" as const,
    targetCurrency: "GHS" as const,
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
      id: "33333333-3333-4333-8333-333333333333",
      reference: "MXR-1",
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
  return { ...base, ...overrides };
}

// ========================================================================
// Exchange Receipts E2E
// ========================================================================

describe("Exchange Receipts E2E", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_EXPIRES_IN: "15m",
              JWT_REFRESH_EXPIRES_IN: "7d",
            }),
          ],
        }),
      ],
      controllers: [ExchangeController, AdminExchangeController],
      providers: [
        ExchangeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RateService, useValue: mockRateService },
        { provide: RedisService, useValue: mockRedis },
        { provide: PinoLogger, useValue: mockPinoLogger },
        { provide: LedgerService, useValue: mockLedger },
        { provide: TransactionPinService, useValue: mockTransactionPin },
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: BankingService, useValue: mockBankingService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

    const redis = moduleFixture.get(RedisService);
    const prisma = moduleFixture.get(PrismaService);
    const logger = moduleFixture.get(PinoLogger);

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalInterceptors(
      new IdempotencyInterceptor(
        redis as unknown as RedisService,
        prisma as unknown as PrismaService,
        logger as unknown as PinoLogger,
      ),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();

    // ----- Default mock behaviours -----
    mockPrisma.$transaction.mockImplementation(
      async (fn: any) => fn(mockPrisma),
    );
    mockRateService.getRate.mockResolvedValue({
      rate: 3.1746,
      markup: 2.5,
    });
    mockRedis.isAvailable.mockReturnValue(false);
    mockRedis.get.mockResolvedValue(null);

    // Idempotency interceptor defaults (no cached / in-flight records)
    mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyRecord.create.mockResolvedValue({
      id: "idem-" + Date.now(),
    });
    mockPrisma.idempotencyRecord.update.mockResolvedValue({});
  });

  afterAll(async () => {
    await app.close();
  });

  // ================================================================
  //  a) Valid receipt upload with signed proof URL
  // ================================================================
  describe("a) Valid receipt upload with signed proof URL", () => {
    it("submits a manual receipt with receiptObjectKey and retrieves a signed proof URL", async () => {
      // --- Arrange: receipt submission ---
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
        wallets: [{ id: "wallet-ghs" }],
      });
      mockPrisma.transaction.create.mockResolvedValue({
        id: "tx-1",
        reference: "MXR-A1",
        status: "PENDING",
      });
      mockPrisma.exchangeReceipt.create.mockResolvedValue(
        buildPrismaReceipt({
          receiptUrl: "exchange-receipts/user-1/abc-123-receipt.pdf",
        }),
      );

      // --- Act: submit receipt ---
      const submitRes = await request(app.getHttpServer())
        .post("/api/exchange/receipts")
        .set("Idempotency-Key", "scenario-a-submit")
        .set("X-Test-User-Id", "user-1")
        .set("X-Test-User-Role", "USER")
        .send({
          amount: "1000",
          bankReference: "BANKREF123",
          senderName: "Ada Lovelace",
          senderBankName: "Test Bank",
          receiptObjectKey: "exchange-receipts/user-1/abc-123-receipt.pdf",
          note: "NGN bank deposit from Access Bank",
        });

      // --- Assert: submission ---
      expect(submitRes.status).toBe(201);
      expect(submitRes.body).toMatchObject({
        status: "SUBMITTED",
        receiptProofType: "MANAGED_STORAGE_OBJECT",
        bankReference: "BANKREF123",
      });
      expect(submitRes.body).toHaveProperty("id");
      expect(submitRes.body).toHaveProperty("transaction");
      expect(submitRes.body.transaction.status).toBe("PENDING");

      const receiptId: string = submitRes.body.id;

      // --- Arrange: proof URL ---
      mockPrisma.exchangeReceipt.findFirst.mockResolvedValue({
        id: receiptId,
        userId: "user-1",
        receiptUrl: "exchange-receipts/user-1/abc-123-receipt.pdf",
        transaction: { reference: "MXR-A1" },
      });
      mockSupabaseService.createSignedReadUrl.mockResolvedValue(
        "https://supabase.co/storage/v1/object/signed/exchange-receipts/user-1/abc-123-receipt.pdf?token=abc123",
      );

      // --- Act: proof URL ---
      const proofRes = await request(app.getHttpServer())
        .get(`/api/exchange/receipts/${receiptId}/proof-url`)
        .set("X-Test-User-Id", "user-1")
        .set("X-Test-User-Role", "USER");

      // --- Assert: proof URL ---
      expect(proofRes.status).toBe(200);
      expect(proofRes.body).toMatchObject({
        receiptId,
        url: expect.stringContaining("supabase.co"),
        expiresInSeconds: 300,
      });
    });
  });

  // ================================================================
  //  b) Duplicate idempotency key returns original (no duplicate processing)
  // ================================================================
  describe("b) Duplicate idempotency key returns original response", () => {
    it("reuses the same Idempotency-Key and receives the cached response without re-processing", async () => {
      const requestBody = {
        amount: "500",
        bankReference: "BANK-IDEM-001",
        senderName: "Bob Ada",
        receiptUrl: "https://example.com/receipt.png",
      };

      // Both requests need the service mocks to succeed
      const user = {
        id: "user-1",
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
        isSuspended: false,
        wallets: [{ id: "wallet-ghs" }],
      };
      const createdTx = {
        id: "tx-idem",
        reference: "MXR-IDEM",
        status: "PENDING",
      };
      const createdReceipt = buildPrismaReceipt({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        bankReference: "BANK-IDEM-001",
      });
      // Also arrange idempotency-record mocks for the first request
      mockPrisma.idempotencyRecord.create.mockResolvedValue({
        id: "idem-b-record",
      });

      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.transaction.create.mockResolvedValue(createdTx);
      mockPrisma.exchangeReceipt.create.mockResolvedValue(createdReceipt);

      // --- First request ---
      const firstRes = await request(app.getHttpServer())
        .post("/api/exchange/receipts")
        .set("Idempotency-Key", "idem-key-b")
        .set("X-Test-User-Id", "user-1")
        .set("X-Test-User-Role", "USER")
        .send(requestBody);

      expect(firstRes.status).toBe(201);
      expect(firstRes.body).toHaveProperty("id");

      // --- Second request with the same key ---
      // The interceptor will call findUnique — return a completed record
      mockPrisma.idempotencyRecord.findUnique.mockReset();
      mockPrisma.idempotencyRecord.findUnique.mockResolvedValue({
        requestHash: hash(requestBody),
        status: "COMPLETED",
        response: firstRes.body,
      });

      const secondRes = await request(app.getHttpServer())
        .post("/api/exchange/receipts")
        .set("Idempotency-Key", "idem-key-b")
        .set("X-Test-User-Id", "user-1")
        .set("X-Test-User-Role", "USER")
        .send(requestBody);

      // Response is identical, and the service was NOT called a second time
      expect(secondRes.status).toBe(201);
      expect(secondRes.body).toEqual(firstRes.body);
      expect(mockPrisma.exchangeReceipt.create).toHaveBeenCalledTimes(1);
    });
  });

  // ================================================================
  //  c) Admin review: approve
  // ================================================================
  describe("c) Admin review: approve", () => {
    it("allows an admin to approve a receipt, credit the GHS wallet, and update the transaction to SUCCESS", async () => {
      const receiptId = "22222222-2222-4222-8222-222222222222";
      const receipt = buildPrismaReceipt({
        id: receiptId,
        bankReference: "BANK-APPROVE",
        status: "SUBMITTED",
      });
      const creditedReceipt = buildPrismaReceipt({
        id: receiptId,
        bankReference: "BANK-APPROVE",
        status: "CREDITED",
        adminId: "admin-1",
        reviewReason: "Receipt matches bank statement reference ABC123XYZ",
        creditedAt: new Date(),
        reviewedAt: new Date(),
        transaction: {
          id: "tx-1",
          reference: "MXR-1",
          status: "SUCCESS",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Two findUnique calls: one in reviewManualReceipt, one inside
      // approveManualReceipt
      mockPrisma.exchangeReceipt.findUnique
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(receipt)
        .mockResolvedValueOnce(creditedReceipt);
      mockPrisma.exchangeReceipt.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.update.mockResolvedValue({
        id: "tx-1",
        status: "SUCCESS",
        reference: "MXR-1",
      });
      mockLedger.creditWallet.mockResolvedValue({
        walletId: "wallet-ghs",
        balanceAfter: new Decimal("3255.46"),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exchange/receipts/${receiptId}/review`)
        .set("Idempotency-Key", "scenario-c-approve")
        .set("X-Test-User-Id", "admin-1")
        .set("X-Test-User-Role", "ADMIN")
        .send({
          status: "APPROVED",
          reason: "Receipt matches bank statement reference ABC123XYZ",
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: receiptId,
        status: "CREDITED",
        adminId: "admin-1",
        reviewReason: expect.stringContaining("bank statement"),
      });
      expect(res.body.transaction.status).toBe("SUCCESS");

      // Ledger credit was performed
      expect(mockLedger.creditWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "GHS",
          source: "MANUAL_EXCHANGE_RECEIPT_CREDIT",
        }),
        mockPrisma,
      );
      // Audit log was written
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: "admin-1",
            action: "MANUAL_EXCHANGE_RECEIPT_CREDIT",
          }),
        }),
      );
    });
  });

  // ================================================================
  //  d) Admin review: reject
  // ================================================================
  describe("d) Admin review: reject", () => {
    it("allows an admin to reject a receipt without crediting the GHS wallet", async () => {
      const receiptId = "44444444-4444-4444-8444-444444444444";
      const receipt = buildPrismaReceipt({
        id: receiptId,
        bankReference: "BANK-REJECT",
        status: "SUBMITTED",
      });
      const rejectedReceipt = buildPrismaReceipt({
        id: receiptId,
        bankReference: "BANK-REJECT",
        status: "REJECTED",
        adminId: "admin-1",
        reviewReason: "Bank statement reference could not be verified against the deposit record",
        reviewedAt: new Date(),
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

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exchange/receipts/${receiptId}/review`)
        .set("Idempotency-Key", "scenario-d-reject")
        .set("X-Test-User-Id", "admin-1")
        .set("X-Test-User-Role", "ADMIN")
        .send({
          status: "REJECTED",
          reason: "Bank statement reference could not be verified against the deposit record",
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: receiptId,
        status: "REJECTED",
        adminId: "admin-1",
      });
      expect(res.body.transaction.status).toBe("FAILED");

      // No wallet credit occurred
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
      // Audit recorded the rejection
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: "admin-1",
            action: "MANUAL_EXCHANGE_RECEIPT_REJECTED",
          }),
        }),
      );
    });
  });

  // ================================================================
  //  e) Admin review: needs-more-info
  // ================================================================
  describe("e) Admin review: needs-more-info", () => {
    it("allows an admin to request more info without crediting or failing the transaction", async () => {
      const receiptId = "55555555-5555-4555-8555-555555555555";
      const receipt = buildPrismaReceipt({
        id: receiptId,
        bankReference: "BANK-NEEDS",
        status: "SUBMITTED",
      });
      const needsInfoReceipt = buildPrismaReceipt({
        id: receiptId,
        bankReference: "BANK-NEEDS",
        status: "NEEDS_MORE_INFO",
        adminId: "admin-1",
        reviewReason: "Receipt image is too blurry to read the bank reference number",
        reviewedAt: new Date(),
        transaction: {
          id: "tx-1",
          reference: "MXR-1",
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
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

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exchange/receipts/${receiptId}/review`)
        .set("Idempotency-Key", "scenario-e-needs-info")
        .set("X-Test-User-Id", "admin-1")
        .set("X-Test-User-Role", "ADMIN")
        .send({
          status: "NEEDS_MORE_INFO",
          reason: "Receipt image is too blurry to read the bank reference number",
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: receiptId,
        status: "NEEDS_MORE_INFO",
        adminId: "admin-1",
      });
      // Transaction remains PENDING
      expect(res.body.transaction.status).toBe("PENDING");

      // No wallet credit
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
      // Audit recorded the action
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: "admin-1",
            action: "MANUAL_EXCHANGE_RECEIPT_NEEDS_MORE_INFO",
          }),
        }),
      );
    });
  });

  // ================================================================
  //  f) Non-admin rejection attempt (should fail with 403)
  // ================================================================
  describe("f) Non-admin rejection attempt returns 403", () => {
    it("blocks a non-admin user from reviewing a receipt", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/admin/exchange/receipts/99999999-9999-4999-8999-999999999999/review")
        .set("Idempotency-Key", "scenario-f-non-admin")
        .set("X-Test-User-Id", "regular-user")
        .set("X-Test-User-Role", "USER")
        .send({
          status: "APPROVED",
          reason: "User should never reach this point",
        });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("message");
      expect(res.body.message).toMatch(/permission/i);

      // Service was never called
      expect(mockPrisma.exchangeReceipt.findUnique).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  //  g) Terminal-state re-review rejection
  // ================================================================
  describe("g) Terminal-state re-review rejection", () => {
    it("prevents re-review of a receipt that is already in a terminal state (CREDITED)", async () => {
      const receiptId = "66666666-6666-4666-8666-666666666666";
      const terminalReceipt = buildPrismaReceipt({
        id: receiptId,
        status: "CREDITED",
      });

      mockPrisma.exchangeReceipt.findUnique.mockResolvedValue(terminalReceipt);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exchange/receipts/${receiptId}/review`)
        .set("Idempotency-Key", "scenario-g-re-review")
        .set("X-Test-User-Id", "admin-1")
        .set("X-Test-User-Role", "ADMIN")
        .send({
          status: "APPROVED",
          reason: "Attempting to credit again",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
      expect(res.body.message).toMatch(/terminal state/i);

      // No credit or audit-log for the second review
      expect(mockLedger.creditWallet).not.toHaveBeenCalled();
      expect(mockPrisma.exchangeReceipt.updateMany).not.toHaveBeenCalled();
    });

    it("prevents re-review of a receipt that is already REJECTED", async () => {
      const receiptId = "77777777-7777-4777-8777-777777777777";
      const terminalReceipt = buildPrismaReceipt({
        id: receiptId,
        status: "REJECTED",
      });

      mockPrisma.exchangeReceipt.findUnique.mockResolvedValue(terminalReceipt);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exchange/receipts/${receiptId}/review`)
        .set("Idempotency-Key", "scenario-g-re-review-rejected")
        .set("X-Test-User-Id", "admin-1")
        .set("X-Test-User-Role", "ADMIN")
        .send({
          status: "APPROVED",
          reason: "Trying to reverse a rejection",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/terminal state/i);
    });
  });

  // ================================================================
  // Proof URL authorization boundaries
  // ================================================================
  describe("Proof URL authorization boundaries", () => {
    const receiptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    it("allows the receipt owner to access their own proof URL", async () => {
      mockPrisma.exchangeReceipt.findFirst.mockResolvedValue({
        id: receiptId,
        userId: "user-1",
        receiptUrl: "exchange-receipts/user-1/owner-proof.pdf",
        transaction: { reference: "MXR-BOUNDARY" },
      });
      mockSupabaseService.createSignedReadUrl.mockResolvedValue(
        "https://supabase.co/storage/v1/object/signed/exchange-receipts/user-1/owner-proof.pdf?token=owner-token",
      );

      const res = await request(app.getHttpServer())
        .get(`/api/exchange/receipts/${receiptId}/proof-url`)
        .set("X-Test-User-Id", "user-1")
        .set("X-Test-User-Role", "USER");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        receiptId,
        url: expect.stringContaining("supabase.co"),
      });
    });

    it("prevents another user from accessing a receipt proof URL (404)", async () => {
      // findFirst includes `userId: requesterId`, so user-2's query finds
      // nothing
      mockPrisma.exchangeReceipt.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get(`/api/exchange/receipts/${receiptId}/proof-url`)
        .set("X-Test-User-Id", "user-2")
        .set("X-Test-User-Role", "USER");

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/receipt not found/i);
    });

    it("allows an admin to access any receipt proof URL via the admin POST endpoint", async () => {
      // Admin findFirst uses no userId filter — it matches by receiptId alone
      mockPrisma.exchangeReceipt.findFirst.mockResolvedValue({
        id: receiptId,
        userId: "user-1",
        receiptUrl: "exchange-receipts/user-1/admin-proof.pdf",
        transaction: { reference: "MXR-BOUNDARY" },
      });
      mockSupabaseService.createSignedReadUrl.mockResolvedValue(
        "https://supabase.co/storage/v1/object/signed/exchange-receipts/user-1/admin-proof.pdf?token=admin-token",
      );
      mockPrisma.auditLog.create.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exchange/receipts/${receiptId}/proof-url`)
        .set("Idempotency-Key", "admin-proof-boundary")
        .set("X-Test-User-Id", "admin-1")
        .set("X-Test-User-Role", "ADMIN")
        .send();

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        receiptId,
        url: expect.stringContaining("supabase.co"),
      });

      // Admin access is audited
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: "admin-1",
            action: "MANUAL_EXCHANGE_RECEIPT_PROOF_VIEW",
          }),
        }),
      );
    });
  });
});
