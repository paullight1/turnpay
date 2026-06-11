import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { BankingService } from "./banking.service";
import { LedgerService } from "../wallets/ledger.service";
import { encryptSensitiveValue } from "../common/utils/encryption";

describe("BankingService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    virtualAccount: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
    providerEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    kycDocument: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const monnifyVirtualAccounts = {
    provisionVirtualAccount: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === "BANKING_ENABLED" || key === "VIRTUAL_ACCOUNTS_ENABLED") {
        return true;
      }

      if (key === "PII_ENCRYPTION_KEY") {
        return "test-pii-encryption-key";
      }

      return defaultValue;
    }),
  };

  const ledger = {
    creditWallet: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let service: BankingService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.virtualAccount.findUnique.mockReset();
    prisma.kycDocument.findMany.mockResolvedValue([]);
    service = new BankingService(
      prisma,
      ledger as unknown as LedgerService,
      monnifyVirtualAccounts as any,
      configService as any,
      logger as any,
    );
  });

  it("returns full account numbers to the authenticated account owner", async () => {
    prisma.virtualAccount.findMany.mockResolvedValue([]);

    await service.getVirtualAccounts("user-1");

    expect(prisma.virtualAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        select: expect.objectContaining({
          accountNumber: true,
          accountNumberMasked: true,
        }),
      }),
    );
  });

  it("requires verified KYC before provisioning a virtual account", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      phone: "+2348012345678",
      kycStatus: "PENDING",
      isSuspended: false,
    });

    await expect(
      service.provisionVirtualAccount("user-1", {
        currency: "NGN",
        provider: "monnify",
        firstName: "Ada",
        lastName: "Lovelace",
        country: "NG",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      monnifyVirtualAccounts.provisionVirtualAccount,
    ).not.toHaveBeenCalled();
  });

  it("returns an existing virtual account without reprovisioning", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.virtualAccount.findUnique.mockResolvedValue({
      id: "va-1",
      provider: "MONNIFY",
      accountNumber: "3397990020",
      accountNumberMasked: "******0020",
      accountName: "Trust Pay",
      bankName: "Wema bank",
      bankCode: "035",
      currency: "NGN",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
    });

    const result = await service.provisionVirtualAccount("user-1", {
      currency: "NGN",
      provider: "monnify",
      firstName: "Ada",
      lastName: "Lovelace",
      country: "NG",
    });

    expect(result.accountNumber).toBe("3397990020");
    expect(result.accountNumberMasked).toBe("******0020");
    expect(monnifyVirtualAccounts.provisionVirtualAccount).not.toHaveBeenCalled();
    expect(prisma.virtualAccount.upsert).not.toHaveBeenCalled();
  });

  it("uses explicit sandbox test KYC only when the development bypass is enabled", async () => {
    configService.get.mockImplementation(
      (key: string, defaultValue?: unknown) => {
        if (key === "BANKING_ENABLED" || key === "VIRTUAL_ACCOUNTS_ENABLED") {
          return true;
        }

        if (key === "NODE_ENV") {
          return "development";
        }

        if (key === "BANKING_SANDBOX_MODE") {
          return true;
        }

        if (key === "MONNIFY_SANDBOX_TEST_KYC_BYPASS") {
          return true;
        }

        if (key === "MONNIFY_TEST_BVN") {
          return "22222222226";
        }

        if (key === "PII_ENCRYPTION_KEY") {
          return "test-pii-encryption-key";
        }

        return defaultValue;
      },
    );
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      phone: "+2348012345678",
      kycStatus: "PENDING",
      kycTier: "TIER_0",
      isSuspended: false,
    });
    monnifyVirtualAccounts.provisionVirtualAccount.mockResolvedValue({
      provider: "monnify",
      providerAccountId: "NWA7DMJ0W2UDK1KN5SLF",
      providerCustomerId: "user@example.com",
      accountNumber: "6254727989",
      accountName: "Ada Lovelace",
      bankName: "Moniepoint Microfinance Bank",
      bankCode: "50515",
      currency: "NGN",
      status: "ACTIVE",
      raw: {},
    });
    prisma.virtualAccount.upsert.mockResolvedValue({
      id: "va-1",
      accountNumberMasked: "******7989",
      bankName: "Moniepoint Microfinance Bank",
      status: "ACTIVE",
    });

    await service.provisionVirtualAccount("user-1", {
      currency: "NGN",
      provider: "monnify",
      firstName: "Ada",
      lastName: "Lovelace",
      country: "NG",
    });

    expect(monnifyVirtualAccounts.provisionVirtualAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        bvn: "22222222226",
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", provider: "monnify" }),
      "Using Monnify sandbox test KYC identifier for virtual account provisioning",
    );
  });

  it("upserts a Monnify virtual account and returns owner-visible account details without raw provider internals", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    monnifyVirtualAccounts.provisionVirtualAccount.mockResolvedValue({
      provider: "monnify",
      providerAccountId: "NWA7DMJ0W2UDK1KN5SLF",
      providerCustomerId: "user@example.com",
      accountNumber: "6254727989",
      accountName: "Ada Lovelace",
      bankName: "Moniepoint Microfinance Bank",
      bankCode: "50515",
      currency: "NGN",
      status: "ACTIVE",
      raw: { bvn: "21212121212", accountNumber: "6254727989" },
    });
    prisma.virtualAccount.upsert.mockResolvedValue({
      id: "va-1",
      accountNumber: "6254727989",
      accountNumberMasked: "******7989",
      bankName: "Moniepoint Microfinance Bank",
      status: "ACTIVE",
    });

    const result = await service.provisionVirtualAccount("user-1", {
      currency: "NGN",
      provider: "monnify",
      firstName: "Ada",
      lastName: "Lovelace",
      country: "NG",
      bvn: "21212121212",
    });

    expect(prisma.virtualAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_provider_currency: {
            userId: "user-1",
            provider: "MONNIFY",
            currency: "NGN",
          },
        },
        select: expect.objectContaining({
          accountNumber: true,
          accountNumberMasked: true,
        }),
      }),
    );
    expect(result.accountNumber).toBe("6254727989");
    expect(result.accountNumberMasked).toBe("******7989");
  });

  it("provisions Monnify reserved accounts with BVN/NIN data", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    monnifyVirtualAccounts.provisionVirtualAccount.mockResolvedValue({
      provider: "monnify",
      providerAccountId: "NWA7DMJ0W2UDK1KN5SLF",
      providerCustomerId: "user@example.com",
      accountNumber: "6254727989",
      accountName: "Ada Lovelace",
      bankName: "Moniepoint Microfinance Bank",
      bankCode: "50515",
      currency: "NGN",
      status: "ACTIVE",
      raw: {
        bvn: "21212121212",
        accounts: [{ accountNumber: "6254727989" }],
      },
    });
    prisma.virtualAccount.upsert.mockResolvedValue({
      id: "va-1",
      accountNumber: "6254727989",
      accountNumberMasked: "******7989",
      bankName: "Moniepoint Microfinance Bank",
      status: "ACTIVE",
    });

    await service.provisionVirtualAccount("user-1", {
      currency: "NGN",
      provider: "monnify",
      firstName: "Ada",
      lastName: "Lovelace",
      country: "NG",
      bvn: "21212121212",
      nin: "12034875601",
    });

    expect(monnifyVirtualAccounts.provisionVirtualAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        currency: "NGN",
        bvn: "21212121212",
        nin: "12034875601",
      }),
    );
    expect(prisma.virtualAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_provider_currency: {
            userId: "user-1",
            provider: "MONNIFY",
            currency: "NGN",
          },
        },
      }),
    );
  });

  it("uses verified encrypted KYC identifiers when DTO BVN/NIN values are absent", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.kycDocument.findMany.mockResolvedValue([
      {
        type: "BVN",
        idNumber: `enc:v1:${encryptSensitiveValue(
          "21212121212",
          "test-pii-encryption-key",
        )}`,
      },
      {
        type: "NIN",
        idNumber: `enc:v1:${encryptSensitiveValue(
          "12034875601",
          "test-pii-encryption-key",
        )}`,
      },
    ]);
    monnifyVirtualAccounts.provisionVirtualAccount.mockResolvedValue({
      provider: "monnify",
      providerAccountId: "NWA7DMJ0W2UDK1KN5SLF",
      providerCustomerId: "user@example.com",
      accountNumber: "6254727989",
      accountName: "Ada Lovelace",
      bankName: "Moniepoint Microfinance Bank",
      bankCode: "50515",
      currency: "NGN",
      status: "ACTIVE",
      raw: {
        accounts: [{ accountNumber: "6254727989" }],
      },
    });
    prisma.virtualAccount.upsert.mockResolvedValue({
      id: "va-1",
      accountNumberMasked: "******7989",
      bankName: "Moniepoint Microfinance Bank",
      status: "ACTIVE",
    });

    await service.provisionVirtualAccount("user-1", {
      currency: "NGN",
      provider: "monnify",
      firstName: "Ada",
      lastName: "Lovelace",
      country: "NG",
    });

    expect(prisma.kycDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          status: "VERIFIED",
          type: { in: ["BVN", "NIN"] },
        },
      }),
    );
    expect(monnifyVirtualAccounts.provisionVirtualAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        bvn: "21212121212",
        nin: "12034875601",
      }),
    );
  });

  it("prefers explicit DTO identifiers over verified KYC document identifiers", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.kycDocument.findMany.mockResolvedValue([
      {
        type: "BVN",
        idNumber: `enc:v1:${encryptSensitiveValue(
          "21212121212",
          "test-pii-encryption-key",
        )}`,
      },
      {
        type: "NIN",
        idNumber: `enc:v1:${encryptSensitiveValue(
          "12034875601",
          "test-pii-encryption-key",
        )}`,
      },
    ]);
    monnifyVirtualAccounts.provisionVirtualAccount.mockResolvedValue({
      provider: "monnify",
      providerAccountId: "NWA7DMJ0W2UDK1KN5SLF",
      providerCustomerId: "user@example.com",
      accountNumber: "6254727989",
      accountName: "Ada Lovelace",
      bankName: "Moniepoint Microfinance Bank",
      bankCode: "50515",
      currency: "NGN",
      status: "ACTIVE",
      raw: {},
    });
    prisma.virtualAccount.upsert.mockResolvedValue({
      id: "va-1",
      accountNumberMasked: "******7989",
      bankName: "Moniepoint Microfinance Bank",
      status: "ACTIVE",
    });

    await service.provisionVirtualAccount("user-1", {
      currency: "NGN",
      provider: "monnify",
      firstName: "Ada",
      lastName: "Lovelace",
      country: "NG",
      bvn: "99999999999",
    });

    expect(monnifyVirtualAccounts.provisionVirtualAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        bvn: "99999999999",
        nin: "12034875601",
      }),
    );
  });

  it("credits a wallet once for a valid virtual-account deposit event", async () => {
    prisma.providerEvent.findUnique.mockResolvedValue(null);
    prisma.providerEvent.create.mockResolvedValue({ id: "event-1" });
    prisma.virtualAccount.findUnique.mockResolvedValue({
      id: "va-1",
      userId: "user-1",
      accountNumber: "6254727989",
      currency: "NGN",
      provider: "MONNIFY",
      status: "ACTIVE",
      user: {
        id: "user-1",
        isSuspended: false,
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
      },
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "MNF-1",
      amount: new Decimal(2500),
      currency: "NGN",
    });
    ledger.creditWallet.mockResolvedValue({ balanceAfter: new Decimal(2500) });

    const result = await service.processVirtualAccountDeposit({
      provider: "monnify",
      eventType: "SUCCESSFUL_TRANSACTION",
      providerReference: "MNF-1",
      accountNumber: "6254727989",
      amount: new Decimal(2500),
      currency: "NGN",
      rawPayload: {
        eventData: {
          transactionReference: "MNF-1",
          destinationAccountInformation: {
            accountNumber: "6254727989",
          },
        },
      },
    });

    expect(result).toEqual({ received: true, processed: true });
    expect(prisma.providerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "MONNIFY",
          providerReference: "MNF-1",
          status: "PROCESSING",
        }),
      }),
    );
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        currency: "NGN",
        amount: new Decimal(2500),
        transactionId: "tx-1",
        reference: "MNF-1",
      }),
      prisma,
    );
    expect(prisma.providerEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "PROCESSED", processedAt: expect.any(Date) },
    });
  });

  it("promotes a pending virtual account to active when a valid deposit arrives", async () => {
    prisma.providerEvent.findUnique.mockResolvedValue(null);
    prisma.providerEvent.create.mockResolvedValue({ id: "event-1" });
    prisma.virtualAccount.findUnique.mockResolvedValue({
      id: "va-1",
      userId: "user-1",
      accountNumber: "6254727989",
      currency: "NGN",
      provider: "MONNIFY",
      status: "PENDING",
      user: {
        id: "user-1",
        isSuspended: false,
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
      },
    });
    prisma.virtualAccount.update.mockResolvedValue({
      id: "va-1",
      status: "ACTIVE",
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "MNF-2",
      amount: new Decimal(2500),
      currency: "NGN",
    });
    ledger.creditWallet.mockResolvedValue({ balanceAfter: new Decimal(2500) });

    const result = await service.processVirtualAccountDeposit({
      provider: "monnify",
      eventType: "SUCCESSFUL_TRANSACTION",
      providerReference: "MNF-2",
      accountNumber: "6254727989",
      amount: new Decimal(2500),
      currency: "NGN",
      rawPayload: {},
    });

    expect(result).toEqual({ received: true, processed: true });
    expect(prisma.virtualAccount.update).toHaveBeenCalledWith({
      where: { id: "va-1" },
      data: { status: "ACTIVE" },
    });
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        currency: "NGN",
        amount: new Decimal(2500),
        transactionId: "tx-1",
        reference: "MNF-2",
      }),
      prisma,
    );
  });

  it("does not double-credit duplicate provider events", async () => {
    prisma.providerEvent.findUnique.mockResolvedValue({
      id: "event-1",
      status: "PROCESSED",
    });

    const result = await service.processVirtualAccountDeposit({
      provider: "monnify",
      eventType: "SUCCESSFUL_TRANSACTION",
      providerReference: "MNF-1",
      accountNumber: "6254727989",
      amount: new Decimal(2500),
      currency: "NGN",
      rawPayload: {},
    });

    expect(result).toEqual({ received: true, processed: false });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it("rejects deposits where the provider currency does not match the virtual account", async () => {
    prisma.providerEvent.findUnique.mockResolvedValue(null);
    prisma.providerEvent.create.mockResolvedValue({ id: "event-1" });
    prisma.virtualAccount.findUnique.mockResolvedValue({
      id: "va-1",
      userId: "user-1",
      accountNumber: "6254727989",
      currency: "NGN",
      provider: "MONNIFY",
      status: "ACTIVE",
      user: {
        id: "user-1",
        isSuspended: false,
        kycStatus: "VERIFIED",
        kycTier: "TIER_2",
      },
    });

    await expect(
      service.processVirtualAccountDeposit({
        provider: "monnify",
        eventType: "SUCCESSFUL_TRANSACTION",
        providerReference: "MNF-1",
        accountNumber: "6254727989",
        amount: new Decimal(2500),
        currency: "GHS",
        rawPayload: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(prisma.providerEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: {
        status: "FAILED",
        errorMessage: "Deposit currency does not match virtual account",
        processedAt: expect.any(Date),
      },
    });
  });
});
