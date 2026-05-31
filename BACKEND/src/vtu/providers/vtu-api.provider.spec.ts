import { of, throwError } from "rxjs";
import { VtuApiProvider } from "./vtu-api.provider";

describe("VtuApiProvider VTpass adapter", () => {
  const httpService = {
    get: jest.fn(),
    post: jest.fn(),
  };
  const configValues = {
    NODE_ENV: "test",
    VTU_PROVIDER: "vtpass",
    VTPASS_BASE_URL: "https://sandbox.vtpass.com/api",
    VTPASS_API_KEY: "api-key",
    VTPASS_PUBLIC_KEY: "public-key",
    VTPASS_SECRET_KEY: "secret-key",
  };
  const configService = {
    get: jest.fn((key: keyof typeof configValues) => configValues[key]),
  };
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let provider: VtuApiProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation(
      (key: keyof typeof configValues) => configValues[key],
    );
    provider = new VtuApiProvider(
      httpService as any,
      configService as any,
      logger as any,
    );
  });

  it("maps TRUSTPAY providers to VTpass service providers", async () => {
    await expect(provider.getProviders("airtime")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "mtn", type: "airtime" }),
        expect.objectContaining({ id: "9mobile", type: "airtime" }),
      ]),
    );
  });

  it("loads data packages through VTpass service variations with GET keys", async () => {
    httpService.get.mockReturnValue(
      of({
        data: {
          content: {
            variations: [
              {
                variation_code: "mtn-100mb-1000",
                name: "N1000 1.5GB - 30 days",
                variation_amount: "1000.00",
              },
            ],
          },
        },
      }),
    );

    const packages = await provider.getPackages("mtn");

    expect(httpService.get).toHaveBeenCalledWith(
      "https://sandbox.vtpass.com/api/service-variations",
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": "api-key",
          "public-key": "public-key",
        },
        params: { serviceID: "mtn-data" },
      },
    );
    expect(packages).toEqual([
      {
        id: "mtn-100mb-1000",
        name: "N1000 1.5GB - 30 days",
        price: 1000,
        validity: "30 days",
      },
    ]);
  });

  it("posts airtime purchases to VTpass pay endpoint with secret-key auth", async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: "000",
          response_description: "TRANSACTION SUCCESSFUL",
          requestId: "202605211122ABC",
          content: {
            transactions: {
              status: "delivered",
              transactionId: "provider-tx-1",
            },
          },
        },
      }),
    );

    const result = await provider.purchase({
      type: "airtime",
      provider: "mtn",
      recipientNumber: "08011111111",
      amount: 100,
      reference: "VTU-1234567890-ABCDEF",
    });

    expect(httpService.post).toHaveBeenCalledWith(
      "https://sandbox.vtpass.com/api/pay",
      expect.objectContaining({
        serviceID: "mtn",
        amount: 100,
        phone: "08011111111",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": "api-key",
          "secret-key": "secret-key",
        },
      },
    );
    expect(
      (httpService.post.mock.calls[0][1] as { request_id: string }).request_id,
    ).toMatch(/^\d{12}[A-Za-z0-9]+$/);
    expect(result).toEqual(
      expect.objectContaining({
        reference: "provider-tx-1",
        status: "success",
        message: "TRANSACTION SUCCESSFUL",
        providerRequestId: expect.any(String),
      }),
    );
  });

  it("requeries VTpass transactions by provider request id", async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: "000",
          response_description: "TRANSACTION SUCCESSFUL",
          requestId: "202605211122ABC",
          content: {
            transactions: {
              status: "delivered",
              transactionId: "provider-tx-1",
            },
          },
        },
      }),
    );

    const result = await provider.requery("202605211122ABC");

    expect(httpService.post).toHaveBeenCalledWith(
      "https://sandbox.vtpass.com/api/requery",
      { request_id: "202605211122ABC" },
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": "api-key",
          "secret-key": "secret-key",
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        reference: "provider-tx-1",
        status: "success",
        providerRequestId: "202605211122ABC",
      }),
    );
  });

  it("reports VTpass health with balance and low-balance warning", async () => {
    httpService.get.mockReturnValue(
      of({
        data: {
          code: "000",
          contents: {
            balance: "1200.50",
          },
        },
      }),
    );

    const result = await provider.getVtpassHealth();

    expect(httpService.get).toHaveBeenCalledWith(
      "https://sandbox.vtpass.com/api/balance",
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": "api-key",
          "public-key": "public-key",
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "vtpass",
        configured: true,
        enabled: true,
        supportsBalance: true,
        balance: expect.objectContaining({
          status: "available",
          amount: "1200.5",
          currency: "NGN",
        }),
        warnings: expect.arrayContaining([
          "VTpass balance is below configured threshold of NGN 5000.",
        ]),
      }),
    );
  });

  it("reports VTpass balance as unknown when credentials are missing", async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "test";
      if (key === "VTU_PROVIDER") return "vtpass";
      return "";
    });
    provider = new VtuApiProvider(
      httpService as any,
      configService as any,
      logger as any,
    );

    const result = await provider.getVtpassHealth();

    expect(httpService.get).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        configured: false,
        enabled: true,
        balance: { status: "unknown", currency: "NGN" },
        warnings: expect.arrayContaining([
          "Missing VTpass apiKey configuration.",
          "Missing VTpass publicKey configuration.",
          "Missing VTpass secretKey configuration.",
        ]),
      }),
    );
  });

  it("normalizes VTpass processing responses as pending", async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          code: "099",
          response_description: "TRANSACTION IS PROCESSING",
        },
      }),
    );

    await expect(
      provider.purchase({
        type: "airtime",
        provider: "mtn",
        recipientNumber: "201000000000",
        amount: 100,
        reference: "VTU-1234567890-PENDING",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "pending",
        message: "TRANSACTION IS PROCESSING",
      }),
    );
  });

  it("treats transport errors as unknown provider results", async () => {
    httpService.post.mockReturnValue(throwError(() => new Error("timeout")));

    await expect(
      provider.purchase({
        type: "airtime",
        provider: "mtn",
        recipientNumber: "300000000000",
        amount: 100,
        reference: "VTU-1234567890-TIMEOUT",
      }),
    ).rejects.toThrow("VTU provider result unknown");
  });
});
