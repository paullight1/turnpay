import { createHmac } from "crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { WebhookController } from "./payment-webhook.controller";

describe("WebhookController", () => {
  const paymentService = {
    verifyPaystackSignature: jest.fn(),
    verifyFlutterwaveSignature: jest.fn(),
    verifyFlutterwaveSecretHash: jest.fn(),
    processTransferWebhook: jest.fn(),
    processWebhookDeposit: jest.fn(),
  };

  const bankingService = {
    processVirtualAccountDeposit: jest.fn(),
  };

  const exchangeService = {
    processMonnifyExchangeDepositWebhook: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const webhookBody = {
    eventType: "SUCCESSFUL_TRANSACTION",
    eventData: {
      transactionReference: "MNF-1",
      paymentReference: "PY-1",
      amountPaid: 1500,
      currency: "NGN",
      paymentStatus: "PAID",
      destinationAccountInformation: {
        accountNumber: "0123456789",
      },
    },
  };

  const rawBody = JSON.stringify(webhookBody);
  const validSignature = createHmac("sha512", "webhook-secret")
    .update(rawBody)
    .digest("hex");

  const request = { rawBody };

  let controller: WebhookController;

  beforeEach(() => {
    jest.clearAllMocks();

    configService.get.mockImplementation((key: string) => {
      if (key === "MONNIFY_WEBHOOK_SECRET") return "webhook-secret";
      return undefined;
    });

    controller = new WebhookController(
      paymentService as any,
      bankingService as any,
      exchangeService as any,
      configService as any,
      logger as any,
    );

    bankingService.processVirtualAccountDeposit.mockResolvedValue({
      received: true,
      processed: true,
    });
    exchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: false,
      processed: false,
    });
  });

  it("rejects Monnify webhooks without a signature", async () => {
    await expect(
      controller.handleMonnifyWebhook(
        undefined as unknown as string,
        request as any,
        webhookBody,
      ),
    ).rejects.toThrow("Missing signature header");
  });

  it("rejects Monnify webhooks with an invalid signature", async () => {
    await expect(
      controller.handleMonnifyWebhook("invalid", request as any, webhookBody),
    ).rejects.toThrow("Invalid signature");
  });

  it("routes matched Monnify exchange webhooks to the exchange service", async () => {
    exchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: true,
      processed: true,
      receiptId: "receipt-1",
    });

    const response = await controller.handleMonnifyWebhook(
      validSignature,
      request as any,
      webhookBody,
    );

    expect(response).toEqual({ received: true, routed: "exchange" });

    expect(
      exchangeService.processMonnifyExchangeDepositWebhook,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SUCCESSFUL_TRANSACTION",
        providerReference: "MNF-1",
        paymentReference: "PY-1",
        accountNumber: "0123456789",
        currency: "NGN",
      }),
    );

    const exchangeInput = exchangeService.processMonnifyExchangeDepositWebhook
      .mock.calls[0]?.[0] as {
      eventType: string;
      amount: Decimal;
    };
    expect(exchangeInput.amount.toString()).toBe("1500");
    expect(exchangeInput.eventType).toBe("SUCCESSFUL_TRANSACTION");
    expect(bankingService.processVirtualAccountDeposit).not.toHaveBeenCalled();
  });

  it("falls back to virtual account deposit when no exchange receipt matches", async () => {
    const response = await controller.handleMonnifyWebhook(
      validSignature,
      request as any,
      webhookBody,
    );

    expect(response).toEqual({ received: true });
    expect(
      exchangeService.processMonnifyExchangeDepositWebhook,
    ).toHaveBeenCalledTimes(1);
    expect(bankingService.processVirtualAccountDeposit).toHaveBeenCalledTimes(
      1,
    );
  });

  it("does not re-route duplicate exchange match events through deposits", async () => {
    exchangeService.processMonnifyExchangeDepositWebhook.mockResolvedValue({
      matched: true,
      processed: false,
      duplicate: true,
    });

    const response = await controller.handleMonnifyWebhook(
      validSignature,
      request as any,
      webhookBody,
    );

    expect(response).toEqual({ received: true, routed: "exchange" });
    expect(bankingService.processVirtualAccountDeposit).not.toHaveBeenCalled();
  });
});
