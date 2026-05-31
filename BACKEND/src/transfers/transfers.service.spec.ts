import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { TransfersService } from "./transfers.service";
import { LedgerService } from "../wallets/ledger.service";

describe("TransfersService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    internalTransferLimitUsage: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    internalTransferAttempt: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const ledger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const transactionPin = {
    verifyRequired: jest.fn(),
  };

  let service: TransfersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.internalTransferLimitUsage.upsert.mockResolvedValue({});
    prisma.internalTransferLimitUsage.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.internalTransferAttempt.create.mockResolvedValue({
      id: "attempt-1",
    });
    prisma.transaction.update.mockResolvedValue({});
    service = new TransfersService(
      prisma,
      ledger as unknown as LedgerService,
      logger as any,
      transactionPin as any,
    );
  });

  it("debits sender, credits recipient, and creates both transaction records atomically", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "sender-1",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: "recipient-1",
      email: "recipient@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.transaction.create
      .mockResolvedValueOnce({
        id: "tx-out",
        reference: "IT-20260516-abc123-OUT",
      })
      .mockResolvedValueOnce({
        id: "tx-in",
        reference: "IT-20260516-abc123-IN",
      });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(750),
    });
    ledger.creditWallet.mockResolvedValue({
      balanceAfter: new Decimal(250),
    });

    const result = await service.sendInternalTransfer("sender-1", {
      recipientEmail: "recipient@example.com",
      amount: "250",
      currency: "NGN",
      note: "Lunch",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
    expect(prisma.internalTransferLimitUsage.updateMany).toHaveBeenCalledTimes(
      2,
    );
    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "sender-1",
        amount: new Decimal(250),
        transactionId: "tx-out",
        source: "INTERNAL_TRANSFER_OUT",
      }),
      prisma,
    );
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "recipient-1",
        amount: new Decimal(250),
        transactionId: "tx-in",
        source: "INTERNAL_TRANSFER_IN",
      }),
      prisma,
    );
    expect(result.status).toBe("SUCCESS");
    expect(result.recipient.maskedIdentifier).toBe("r***@example.com");
    expect(result).not.toHaveProperty("recipientTransactionReference");
    expect(prisma.internalTransferAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "sender-1",
        recipientUserId: "recipient-1",
        status: "SUCCESS",
        amount: new Decimal(250),
        currency: "NGN",
        recipientIdentifierType: "EMAIL",
        recipientMaskedIdentifier: "r***@example.com",
      }),
    });
  });

  it("rejects Tier 2 internal transfers above the per-transaction limit", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "sender-1",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });

    await expect(
      service.sendInternalTransfer("sender-1", {
        recipientEmail: "recipient@example.com",
        amount: "250000.01",
        currency: "NGN",
      }),
    ).rejects.toThrow("Internal transfer limit exceeded");

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.internalTransferAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "sender-1",
        status: "FAILED",
        amount: new Decimal("250000.01"),
        currency: "NGN",
        failureCode: "BAD_REQUEST",
      }),
    });
  });

  it("rejects transfers when daily or monthly usage cannot be reserved", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "sender-1",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: "recipient-1",
      email: "recipient@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.internalTransferLimitUsage.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.sendInternalTransfer("sender-1", {
        recipientEmail: "recipient@example.com",
        amount: "250",
        currency: "NGN",
      }),
    ).rejects.toThrow("daily internal transfer limit exceeded");

    expect(ledger.debitWallet).not.toHaveBeenCalled();
    expect(prisma.internalTransferAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "sender-1",
        recipientUserId: "recipient-1",
        status: "FAILED",
        failureCode: "BAD_REQUEST",
      }),
    });
  });

  it("requires verified sender KYC", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "sender-1",
      kycStatus: "PENDING",
      isSuspended: false,
    });

    await expect(
      service.sendInternalTransfer("sender-1", {
        recipientEmail: "recipient@example.com",
        amount: "250",
        currency: "NGN",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("requires sender KYC tier 2 for money transfers", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "sender-1",
      kycStatus: "VERIFIED",
      kycTier: "TIER_1",
      isSuspended: false,
    });

    await expect(
      service.sendInternalTransfer("sender-1", {
        recipientEmail: "recipient@example.com",
        amount: "250",
        currency: "NGN",
      }),
    ).rejects.toThrow("sender must be at least Tier 2 for transfers");
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("uses a privacy-safe error for blocked recipients", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "sender-1",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: "recipient-1",
      email: "recipient@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: true,
    });

    await expect(
      service.sendInternalTransfer("sender-1", {
        recipientEmail: "recipient@example.com",
        amount: "250",
        currency: "NGN",
      }),
    ).rejects.toThrow("Recipient cannot be found or used");
  });

  it("rejects transfer to self", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "sender-1",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: "sender-1",
      email: "sender@example.com",
      phone: "+2348012345678",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });

    await expect(
      service.sendInternalTransfer("sender-1", {
        recipientEmail: "sender@example.com",
        amount: "250",
        currency: "NGN",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns a privacy-safe error for unknown recipients", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "sender-1",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
    });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.sendInternalTransfer("sender-1", {
        recipientEmail: "missing@example.com",
        amount: "250",
        currency: "NGN",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("requires exactly one recipient identifier", async () => {
    await expect(
      service.sendInternalTransfer("sender-1", {
        recipientEmail: "recipient@example.com",
        recipientPhone: "+2348012345678",
        amount: "250",
        currency: "NGN",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns sanitized transfer details for the owner reference", async () => {
    prisma.transaction.findFirst.mockResolvedValue({
      id: "tx-out",
      reference: "IT-20260516-abc123-OUT",
      type: "INTERNAL_TRANSFER",
      amount: new Decimal(250),
      currency: "NGN",
      status: "SUCCESS",
      metadata: {
        direction: "OUT",
        transferReference: "IT-20260516-abc123",
        counterpartyUserId: "recipient-1",
        counterpartyMaskedIdentifier: "r***@example.com",
        note: "Lunch",
      },
      createdAt: new Date("2026-05-16T12:00:00Z"),
      updatedAt: new Date("2026-05-16T12:00:00Z"),
    });

    const result = await service.getInternalTransferByReference(
      "sender-1",
      "IT-20260516-abc123",
    );

    expect(result).toEqual(
      expect.objectContaining({
        reference: "IT-20260516-abc123",
        transactionReference: "IT-20260516-abc123-OUT",
        direction: "OUT",
        counterparty: {
          maskedIdentifier: "r***@example.com",
        },
        note: "Lunch",
      }),
    );
    expect(result).not.toHaveProperty("metadata");
  });
});
