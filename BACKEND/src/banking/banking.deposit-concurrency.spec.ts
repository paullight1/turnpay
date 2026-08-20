import { Decimal } from "@prisma/client/runtime/library";
import { BankingService } from "./banking.service";

describe("BankingService deposit concurrency", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    virtualAccount: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    transaction: { create: jest.fn() },
    providerEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    kycDocument: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const ledger = { creditWallet: jest.fn() };
  const monnifyVirtualAccounts = { provisionVirtualAccount: jest.fn() };
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === "BANKING_ENABLED" || key === "VIRTUAL_ACCOUNTS_ENABLED") {
        return true;
      }
      return defaultValue;
    }),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const event = {
    provider: "monnify" as const,
    eventType: "SUCCESSFUL_TRANSACTION",
    providerReference: "MNF-CONCURRENT-1",
    accountNumber: "6254727989",
    amount: new Decimal(2500),
    currency: "NGN" as const,
    rawPayload: {},
  };

  let service: BankingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BankingService(
      prisma as any,
      ledger as any,
      monnifyVirtualAccounts as any,
      configService as any,
      logger as any,
    );
  });

  it("treats an already-processing provider event as an in-flight duplicate", async () => {
    prisma.providerEvent.findUnique.mockResolvedValue({
      id: "event-1",
      status: "PROCESSING",
    });
    prisma.$transaction.mockRejectedValue(
      new Error("in-flight duplicates must not start a transaction"),
    );

    await expect(service.processVirtualAccountDeposit(event)).resolves.toEqual({
      received: true,
      processed: false,
      duplicate: true,
      inFlight: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it("does not let two retries claim the same failed provider event", async () => {
    prisma.providerEvent.findUnique.mockResolvedValue({
      id: "event-1",
      status: "FAILED",
    });
    prisma.providerEvent.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockRejectedValue(
      new Error("a retry that lost the claim must not start a transaction"),
    );

    await expect(service.processVirtualAccountDeposit(event)).resolves.toEqual({
      received: true,
      processed: false,
      duplicate: true,
      inFlight: true,
    });

    expect(prisma.providerEvent.updateMany).toHaveBeenCalledWith({
      where: {
        id: "event-1",
        status: { in: ["RECEIVED", "FAILED"] },
      },
      data: {
        status: "PROCESSING",
        errorMessage: null,
        processedAt: null,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });
});
