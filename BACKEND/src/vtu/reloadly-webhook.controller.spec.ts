import { BadRequestException } from "@nestjs/common";
import { createHmac } from "crypto";
import { ReloadlyWebhookController } from "./reloadly-webhook.controller";

describe("ReloadlyWebhookController", () => {
  const vtuService = {
    recordReloadlyWebhookEvent: jest.fn(),
    processReloadlyWebhookEvent: jest.fn(),
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

  let controller: ReloadlyWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockReturnValue(undefined);
    vtuService.recordReloadlyWebhookEvent.mockResolvedValue({
      duplicate: false,
      reference: "reloadly:event-1",
      logId: "webhook-log-1",
    });
    vtuService.processReloadlyWebhookEvent.mockResolvedValue({
      processed: true,
    });
    controller = new ReloadlyWebhookController(
      vtuService as any,
      configService as any,
      logger as any,
    );
  });

  it("accepts a valid signed Reloadly webhook and schedules processing", async () => {
    const secret = "reloadly-webhook-test-secret";
    const body = {
      id: "event-1",
      eventType: "topup.status",
      data: {
        transaction: {
          transactionId: 12345,
          customIdentifier: "VTU-1",
          status: "SUCCESSFUL",
          message: "Delivered",
        },
      },
    };
    const rawBody = JSON.stringify(body);
    const signature = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    configService.get.mockReturnValue(secret);

    await expect(
      controller.handleReloadlyWebhook(
        signature,
        undefined,
        undefined,
        undefined,
        { rawBody } as any,
        body,
      ),
    ).resolves.toEqual({ received: true });

    expect(vtuService.recordReloadlyWebhookEvent).toHaveBeenCalledWith({
      eventId: "event-1",
      eventType: "topup.status",
      providerReference: "12345",
      providerRequestId: "VTU-1",
      status: "successful",
      message: "Delivered",
      rawPayload: body,
    });
    expect(vtuService.processReloadlyWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: "12345",
        status: "successful",
      }),
    );
  });

  it("rejects invalid Reloadly signatures when webhook secret is configured", async () => {
    configService.get.mockReturnValue("reloadly-webhook-test-secret");

    await expect(
      controller.handleReloadlyWebhook(
        "invalid-signature",
        undefined,
        undefined,
        undefined,
        { rawBody: "{}" } as any,
        {},
      ),
    ).rejects.toThrow(BadRequestException);

    expect(vtuService.recordReloadlyWebhookEvent).not.toHaveBeenCalled();
    expect(vtuService.processReloadlyWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects Reloadly webhooks when no webhook secret is configured", async () => {
    const body = {
      event: "topup.status",
      transactionId: "reloadly-tx-1",
      customIdentifier: "VTU-1",
      status: "FAILED",
    };

    await expect(
      controller.handleReloadlyWebhook(
        undefined,
        undefined,
        undefined,
        undefined,
        {} as any,
        body,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(vtuService.recordReloadlyWebhookEvent).not.toHaveBeenCalled();
  });

  it("normalizes Reloadly utility payment webhooks by reference id", async () => {
    const secret = "reloadly-webhook-test-secret";
    const body = {
      id: "utility-event-1",
      type: "utility_transaction.status",
      data: {
        referenceId: "VTU-UTILITY-1",
        status: "SUCCESSFUL",
        message: "Payment successful",
        billDetails: {
          billerReferenceId: "BILLER-REF-1",
        },
      },
    };
    const rawBody = JSON.stringify(body);
    const signature = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    configService.get.mockReturnValue(secret);

    await expect(
      controller.handleReloadlyWebhook(
        signature,
        undefined,
        undefined,
        undefined,
        { rawBody } as any,
        body,
      ),
    ).resolves.toEqual({ received: true });

    expect(vtuService.recordReloadlyWebhookEvent).toHaveBeenCalledWith({
      eventId: "utility-event-1",
      eventType: "utility_transaction.status",
      providerReference: "VTU-UTILITY-1",
      providerRequestId: "VTU-UTILITY-1",
      status: "successful",
      message: "Payment successful",
      rawPayload: body,
    });
  });
});
