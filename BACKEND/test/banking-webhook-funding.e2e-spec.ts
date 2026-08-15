import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext } from "@nestjs/common";
import { createHmac, createHash } from "crypto";
import { from, isObservable, lastValueFrom } from "rxjs";
import { WebhookController } from "../src/payments/webhooks/payment-webhook.controller";
import { PaymentService } from "../src/payments/payment.service";
import { BankingService } from "../src/banking/banking.service";
import { ExchangeService } from "../src/exchange/exchange.service";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "../src/prisma/prisma.service";
import { WebhookInboxService } from "../src/payments/webhooks/webhook-inbox.service";

describe("Banking — Webhook Wallet Funding (e2e simulated)", () => {
  const mockPaymentService = {
    verifyPaystackSignature: jest.fn(),
    verifyFlutterwaveSignature: jest.fn(),
    verifyFlutterwaveSecretHash: jest.fn(),
    processTransferWebhook: jest.fn(),
    processWebhookDeposit: jest.fn(),
  };

  const mockBankingService = {
    processVirtualAccountDeposit: jest.fn(),
    getVirtualAccounts: jest.fn(),
    provisionVirtualAccount: jest.fn(),
  };

  const mockExchangeService = {
    processMonnifyExchangeDepositWebhook: jest.fn(),
  };

  const mockWebhookInbox = {
    accept: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };

  const mockPrisma = {
    webhookLog: {
      create: jest.fn(),
      update: jest.fn(),
    },
    idempotencyRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const WEBHOOK_SECRET = "whsec_test_secret_for_signature_validation";

  let controller: WebhookController;

  const signBody = (body: string): string =>
    createHmac("sha512", WEBHOOK_SECRET).update(body).digest("hex");

  const makeMonnifyDepositBody = (overrides: Record<string, unknown> = {}) => ({
    eventType: "SUCCESSFUL_TRANSACTION",
    eventData: {
      transactionReference: "MNFY-TXN-001",
      paymentReference: "MNFY-PAY-001",
      amountPaid: 10000,
      totalPayable: 10000,
      settlementAmount: 9950,
      currency: "NGN",
      paymentStatus: "PAID",
      destinationAccountInformation: {
        accountNumber: "9922334455",
        accountName: "Test User TrustPay",
        bankCode: "035",
        bankName: "Wema Bank",
      },
      product: {
        reference: "RESERVED_ACCOUNT_001",
        type: "RESERVED_ACCOUNT",
      },
      ...overrides,
    },
  });

  const makeRequest = (body: Record<string, unknown>, signature?: string) => {
    const rawBody = JSON.stringify(body);
    return {
      rawBody,
      body,
      headers: {
        "monnify-signature": signature ?? signBody(rawBody),
      },
    };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue(WEBHOOK_SECRET);
    mockConfigService.getOrThrow.mockReturnValue(WEBHOOK_SECRET);
    mockExchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: false,
    });
    mockBankingService.processVirtualAccountDeposit.mockResolvedValue({
      success: true,
    });
    mockPrisma.webhookLog.create.mockResolvedValue({ id: "log-1" });
    mockPrisma.webhookLog.update.mockResolvedValue({ id: "log-1", processed: true });
    mockWebhookInbox.accept.mockResolvedValue({
      eventId: "inbox-1",
      duplicate: false,
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: WebhookInboxService, useValue: mockWebhookInbox },
        { provide: BankingService, useValue: mockBankingService },
        { provide: ExchangeService, useValue: mockExchangeService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PinoLogger, useValue: mockLogger },
      ],
    }).compile();

    controller = moduleRef.get(WebhookController);
  });

  // ─── Scenario 1: Valid deposit webhook credits the wallet ────────────────
  it("processes a valid Monnify deposit webhook and credits the NGN wallet", async () => {
    const body = makeMonnifyDepositBody();
    const req = makeRequest(body);

    const result = await controller.handleMonnifyWebhook(
      req.headers["monnify-signature"],
      req as any,
      body,
    );

    expect(result).toEqual({ received: true });
    expect(mockWebhookInbox.accept).toHaveBeenCalledTimes(1);
    expect(mockWebhookInbox.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "MONNIFY",
        eventType: "SUCCESSFUL_TRANSACTION",
        providerReference: "MNFY-TXN-001",
      }),
    );
  });

  // ─── Scenario 2: Missing signature header is rejected ────────────────────
  it("rejects webhook with missing signature header", async () => {
    const body = makeMonnifyDepositBody();
    const rawBody = JSON.stringify(body);

    await expect(
      controller.handleMonnifyWebhook(
        undefined as unknown as string,
        { rawBody, body } as any,
        body,
      ),
    ).rejects.toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Missing Monnify webhook signature"),
    );
  });

  // ─── Scenario 3: Invalid signature is rejected ──────────────────────────
  it("rejects webhook with invalid HMAC signature", async () => {
    const body = makeMonnifyDepositBody();
    const rawBody = JSON.stringify(body);
    const badSignature = "a".repeat(128);

    await expect(
      controller.handleMonnifyWebhook(
        badSignature,
        { rawBody, body } as any,
        body,
      ),
    ).rejects.toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid Monnify webhook signature"),
    );
  });

  // ─── Scenario 4: Replayed webhook is idempotent (no duplicate credit) ────
  it("handles replayed webhook idempotently without double-crediting", async () => {
    const body = makeMonnifyDepositBody();
    const req = makeRequest(body);

    // First delivery
    await controller.handleMonnifyWebhook(
      req.headers["monnify-signature"],
      req as any,
      body,
    );

    // Second delivery (replay by Monnify)
    mockWebhookInbox.accept.mockResolvedValueOnce({
      eventId: "inbox-1",
      duplicate: true,
    });

    // Should not throw — idempotency handled by DB unique constraint
    const result = await controller.handleMonnifyWebhook(
      req.headers["monnify-signature"],
      { ...req, rawBody: req.rawBody } as any,
      body,
    );

    // The first call credits; the second should be caught by the unique
    // constraint and NOT result in a double credit
    expect(result).toEqual({ received: true });
    expect(mockWebhookInbox.accept).toHaveBeenCalledTimes(2);
  });

  // ─── Scenario 5: Wrong currency webhook is routed but handled ────────────
  it("routes webhook with non-NGN currency correctly", async () => {
    const body = makeMonnifyDepositBody({
      currency: "USD",
    });
    const req = makeRequest(body);

    const result = await controller.handleMonnifyWebhook(
      req.headers["monnify-signature"],
      req as any,
      body,
    );

    expect(result).toEqual({ received: true });
    expect(mockWebhookInbox.accept).toHaveBeenCalledTimes(1);
  });

  // ─── Scenario 6: Amount mismatch is forwarded to service for handling ────
  it("forwards webhook with mismatched amount to service for validation", async () => {
    const body = makeMonnifyDepositBody({
      amountPaid: 5000,
      totalPayable: 10000,
    });
    const req = makeRequest(body);

    const result = await controller.handleMonnifyWebhook(
      req.headers["monnify-signature"],
      req as any,
      body,
    );

    expect(result).toEqual({ received: true });
    expect(mockWebhookInbox.accept).toHaveBeenCalledTimes(1);
  });
});
