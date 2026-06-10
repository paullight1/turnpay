import { BadRequestException } from "@nestjs/common";
import { createHmac } from "crypto";
import { VtpassWebhookController } from "./vtpass-webhook.controller";

describe("VtpassWebhookController", () => {
  const vtuService = {
    recordVtpassWebhookEvent: jest.fn(),
    processVtpassWebhookEvent: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let controller: VtpassWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockReturnValue(undefined);
    vtuService.recordVtpassWebhookEvent.mockResolvedValue({
      duplicate: false,
      reference: "vtpass:transaction-update:REQ-1:TX-1:delivered",
      logId: "webhook-log-1",
    });
    vtuService.processVtpassWebhookEvent.mockResolvedValue({
      processed: true,
    });
    controller = new VtpassWebhookController(
      vtuService as any,
      configService as any,
      logger as any,
    );
  });

  it("accepts a valid signed VTpass transaction update webhook", async () => {
    const secret = "vtpass-webhook-test-secret";
    const body = {
      type: "transaction-update",
      data: {
        code: "000",
        requestId: "REQ-1",
        response_description: "TRANSACTION DELIVERED",
        content: {
          transactions: {
            status: "delivered",
            transactionId: "TX-1",
          },
        },
      },
    };
    const rawBody = JSON.stringify(body);
    const signature = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    configService.get.mockReturnValue(secret);

    await expect(
      controller.handleVtpassWebhook(
        signature,
        undefined,
        undefined,
        undefined,
        undefined,
        { rawBody } as any,
        body,
      ),
    ).resolves.toEqual({ response: "success" });

    expect(vtuService.recordVtpassWebhookEvent).toHaveBeenCalledWith({
      eventType: "transaction-update",
      providerRequestId: "REQ-1",
      providerReference: "TX-1",
      status: "delivered",
      message: "TRANSACTION DELIVERED",
      rawPayload: body,
    });
    expect(vtuService.processVtpassWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRequestId: "REQ-1",
        providerReference: "TX-1",
        status: "delivered",
      }),
    );
  });

  it("accepts a configured shared secret token for dashboard callback URLs", async () => {
    const secret = "vtpass-dashboard-token";
    const body = {
      type: "transaction-update",
      data: {
        requestId: "REQ-2",
        response_description: "TRANSACTION REVERSAL TO WALLET",
        content: {
          transactions: {
            status: "reversed",
            transactionId: "TX-2",
          },
        },
      },
    };
    configService.get.mockReturnValue(secret);

    await expect(
      controller.handleVtpassWebhook(
        undefined,
        undefined,
        undefined,
        undefined,
        secret,
        { rawBody: JSON.stringify(body) } as any,
        body,
      ),
    ).resolves.toEqual({ response: "success" });

    expect(vtuService.recordVtpassWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRequestId: "REQ-2",
        providerReference: "TX-2",
        status: "reversed",
      }),
    );
  });

  it("rejects VTpass webhooks when the configured secret does not match", async () => {
    configService.get.mockReturnValue("vtpass-webhook-test-secret");

    await expect(
      controller.handleVtpassWebhook(
        undefined,
        undefined,
        undefined,
        "wrong-secret",
        undefined,
        { rawBody: "{}" } as any,
        {},
      ),
    ).rejects.toThrow(BadRequestException);

    expect(vtuService.recordVtpassWebhookEvent).not.toHaveBeenCalled();
    expect(vtuService.processVtpassWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects VTpass webhooks when no webhook secret is configured", async () => {
    await expect(
      controller.handleVtpassWebhook(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { rawBody: "{}" } as any,
        {},
      ),
    ).rejects.toThrow(BadRequestException);

    expect(vtuService.recordVtpassWebhookEvent).not.toHaveBeenCalled();
  });
});
