import { BadRequestException } from "@nestjs/common";
import {
  Decimal,
} from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { PaymentService } from "./payment.service";
import { encryptSensitiveValue } from "../common/utils/encryption";

describe("PaymentService withdrawals", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    bankAccount: {
      findFirst: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    providerEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    transferAttempt: {
      create: jest.fn(),
      update: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const wallets = {
    getWallet: jest.fn(),
  };
  const users = {};
  const paystack = {
    createTransferRecipient: jest.fn(),
    initiateTransfer: jest.fn(),
  };
  const monnifyBanks = {
    listBanks: jest.fn(),
    resolveBankAccount: jest.fn(),
    initiateTransfer: jest.fn(),
  };
  const flutterwave = {};
  const config = {
    get: jest.fn((key: string) =>
      key === "BANK_ACCOUNT_ENCRYPTION_KEY"
        ? "test-bank-account-encryption-key"
        : undefined,
    ),
    getOrThrow: jest.fn(() => "secret"),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const http = {};
  const ledger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };
  const transactionPin = {
    verifyRequired: jest.fn(),
  };

  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentService(
      prisma,
      wallets as any,
      users as any,
      paystack as any,
      flutterwave as any,
      monnifyBanks as any,
      config as any,
      logger as any,
      http as any,
      ledger as any,
      transactionPin as any,
    );
  });

  it("withdraws to a saved beneficiary using ledger debit and transfer attempt tracking", async () => {
    wallets.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
      dailyWithdrawLimit: new Decimal(500000),
      monthlyWithdrawLimit: new Decimal(5000000),
      dailyWithdrawn: new Decimal(0),
      monthlyWithdrawn: new Decimal(0),
      limitResetDate: new Date(Date.now() + 86400000),
    });
    prisma.bankAccount.findFirst.mockResolvedValue({
      id: "beneficiary-1",
      bankCode: "044",
      bankName: "Test Bank",
      accountName: "ADA LOVELACE",
      accountNumberEncrypted: encryptSensitiveValue(
        "0123456789",
        "test-bank-account-encryption-key",
      ),
      accountNumberMasked: "******6789",
      currency: "NGN",
      provider: "MONNIFY",
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "WD-1",
    });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4000),
    });
    monnifyBanks.resolveBankAccount.mockResolvedValue({
      accountName: "ADA LOVELACE",
      bankName: "Test Bank",
      bankCode: "044",
    });
    monnifyBanks.initiateTransfer.mockResolvedValue({
      reference: "WD-1",
      status: "SUCCESS",
    });
    prisma.transferAttempt.create.mockResolvedValue({
      id: "attempt-1",
    });

    const result = await service.withdraw("user-1", {
      amount: "1000",
      currency: "NGN",
      beneficiaryId: "beneficiary-1",
      provider: "monnify",
    } as any);

    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        amount: new Decimal(1000),
        transactionId: "tx-1",
        source: "WITHDRAWAL",
      }),
      prisma,
    );
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          accountNumberMasked: "******6789",
        }),
      }),
    });
    expect(
      JSON.stringify(prisma.transaction.create.mock.calls[0][0]),
    ).not.toContain("0123456789");
    expect(prisma.transferAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: "tx-1",
        provider: "MONNIFY",
        providerReference: "WD-1",
        providerStatus: "RESERVED",
        status: "PENDING",
      }),
      select: { id: true },
    });
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: expect.objectContaining({
        providerStatus: "SUCCESS",
        status: "SUCCESS",
      }),
    });
    expect(result.reference).toBe("WD-1");
  });

  it("reverses the ledger debit once when provider transfer fails synchronously", async () => {
    wallets.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
      dailyWithdrawLimit: new Decimal(500000),
      monthlyWithdrawLimit: new Decimal(5000000),
      dailyWithdrawn: new Decimal(0),
      monthlyWithdrawn: new Decimal(0),
      limitResetDate: new Date(Date.now() + 86400000),
    });
    prisma.bankAccount.findFirst.mockResolvedValue({
      id: "beneficiary-1",
      bankCode: "044",
      bankName: "Test Bank",
      accountName: "ADA LOVELACE",
      accountNumberEncrypted: encryptSensitiveValue(
        "0123456789",
        "test-bank-account-encryption-key",
      ),
      accountNumberMasked: "******6789",
      currency: "NGN",
      provider: "MONNIFY",
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "WD-1",
    });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4000),
    });
    monnifyBanks.resolveBankAccount.mockResolvedValue({
      accountName: "ADA LOVELACE",
      bankName: "Test Bank",
      bankCode: "044",
    });
    monnifyBanks.initiateTransfer.mockResolvedValue({
      reference: "WD-1",
      status: "FAILED",
    });
    prisma.transferAttempt.create.mockResolvedValue({
      id: "attempt-1",
    });

    await expect(
      service.withdraw("user-1", {
        amount: "1000",
        currency: "NGN",
        beneficiaryId: "beneficiary-1",
        provider: "monnify",
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        amount: new Decimal(1000),
        transactionId: "tx-1",
        source: "WITHDRAWAL_REVERSAL",
      }),
      prisma,
    );
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: expect.objectContaining({
        providerStatus: "FAILED",
        status: "FAILED",
      }),
    });
  });

  it("processes transfer success webhooks through provider events", async () => {
    prisma.providerEvent.create.mockResolvedValue({
      id: "event-1",
      status: "PROCESSING",
    });
    prisma.transaction.findUnique.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      type: "WITHDRAW",
      status: "PENDING",
      amount: new Decimal(1000),
      currency: "NGN",
      reference: "WD-1",
      transferAttempts: [
        {
          id: "attempt-1",
          metadata: { accountNumberMasked: "******6789" },
        },
      ],
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.processTransferWebhook({
      provider: "monnify",
      eventType: "SUCCESSFUL_DISBURSEMENT",
      providerReference: "WD-1",
      providerStatus: "SUCCESS",
      rawPayload: {
        eventType: "SUCCESSFUL_DISBURSEMENT",
        data: {
          reference: "WD-1",
          status: "SUCCESS",
          account_number: "0123456789",
        },
      },
    });

    expect(result).toEqual({ received: true, processed: true });
    expect(prisma.providerEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: "MONNIFY",
        eventType: "SUCCESSFUL_DISBURSEMENT",
        providerReference: "WD-1",
        status: "PROCESSING",
        payload: expect.objectContaining({
          data: expect.not.objectContaining({
            account_number: "0123456789",
          }),
        }),
      }),
      select: { id: true, status: true },
    });
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", status: "PENDING" },
      data: { status: "SUCCESS" },
    });
    expect(prisma.transferAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "attempt-1" },
        data: expect.objectContaining({
          providerStatus: "SUCCESS",
          status: "SUCCESS",
        }),
      }),
    );
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it("returns duplicate result when a transfer webhook event is already processed", async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`provider`,`providerReference`,`eventType`,`payloadHash`)",
      {
        code: "P2002",
        clientVersion: "6.17.0",
        meta: { target: ["provider", "providerReference", "eventType", "payloadHash"] },
      },
    );
    prisma.providerEvent.create.mockRejectedValue(duplicateError);

    const result = await service.processTransferWebhook({
      provider: "monnify",
      eventType: "SUCCESSFUL_DISBURSEMENT",
      providerReference: "WD-1",
      providerStatus: "SUCCESS",
      rawPayload: {
        eventType: "SUCCESSFUL_DISBURSEMENT",
        data: {
          reference: "WD-1",
          status: "SUCCESS",
        },
      },
    });

    expect(result).toEqual({
      received: true,
      processed: false,
      duplicate: true,
    });
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.transferAttempt.update).not.toHaveBeenCalled();
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it("ignores transfer webhook events when the referenced withdrawal does not exist", async () => {
    prisma.providerEvent.create.mockResolvedValue({
      id: "event-1",
      status: "PROCESSING",
    });
    prisma.transaction.findUnique.mockResolvedValue(null);

    const result = await service.processTransferWebhook({
      provider: "monnify",
      eventType: "FAILED_DISBURSEMENT",
      providerReference: "WD-MISSING",
      providerStatus: "FAILED",
      rawPayload: {
        eventType: "FAILED_DISBURSEMENT",
        data: {
          reference: "WD-MISSING",
          status: "FAILED",
        },
      },
    });

    expect(result).toEqual({ received: true, processed: false });
    expect(prisma.providerEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: {
        status: "IGNORED",
        errorMessage: "Withdrawal transaction not found",
        processedAt: expect.any(Date),
      },
    });
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it("reverses failed transfer webhooks exactly once when no reversal exists", async () => {
    prisma.providerEvent.create.mockResolvedValue({
      id: "event-1",
      status: "PROCESSING",
    });
    prisma.transaction.findUnique.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      type: "WITHDRAW",
      status: "PENDING",
      amount: new Decimal(1000),
      currency: "NGN",
      reference: "WD-1",
      transferAttempts: [{ id: "attempt-1", metadata: {} }],
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await service.processTransferWebhook({
      provider: "monnify",
      eventType: "FAILED_DISBURSEMENT",
      providerReference: "WD-1",
      providerStatus: "FAILED",
      rawPayload: {
        eventType: "FAILED_DISBURSEMENT",
        data: { reference: "WD-1", status: "FAILED" },
      },
    });

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        transactionId: "tx-1",
        reference: "WD-1-REVERSAL",
        source: "WITHDRAWAL_REVERSAL",
      }),
      prisma,
    );
  });

  it("resets stale withdrawal counters before applying daily/monthly limits", async () => {
    wallets.getWallet.mockResolvedValue({
      id: "wallet-1",
      balance: new Decimal(5000),
    });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      isSuspended: false,
      dailyWithdrawLimit: new Decimal(500000),
      monthlyWithdrawLimit: new Decimal(5000000),
      dailyWithdrawn: new Decimal(0),
      monthlyWithdrawn: new Decimal(0),
      limitResetDate: new Date(2020, 0, 1),
    });
    prisma.bankAccount.findFirst.mockResolvedValue({
      id: "beneficiary-1",
      bankCode: "044",
      bankName: "Test Bank",
      accountName: "ADA LOVELACE",
      accountNumberEncrypted: encryptSensitiveValue(
        "0123456789",
        "test-bank-account-encryption-key",
      ),
      accountNumberMasked: "******6789",
      currency: "NGN",
      provider: "MONNIFY",
    });
    prisma.transaction.create.mockResolvedValue({
      id: "tx-1",
      reference: "WD-1",
    });
    prisma.user.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4000),
    });
    monnifyBanks.resolveBankAccount.mockResolvedValue({
      accountName: "ADA LOVELACE",
      bankName: "Test Bank",
      bankCode: "044",
    });
    monnifyBanks.initiateTransfer.mockResolvedValue({
      reference: "WD-1",
      status: "SUCCESS",
    });
    prisma.transferAttempt.create.mockResolvedValue({
      id: "attempt-1",
    });

    const result = await service.withdraw("user-1", {
      amount: "1000",
      currency: "NGN",
      beneficiaryId: "beneficiary-1",
      provider: "monnify",
    } as any);

    expect(prisma.user.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "user-1",
          OR: [{ limitResetDate: null }, { limitResetDate: { lt: expect.any(Date) } }],
        },
        data: expect.objectContaining({
          dailyWithdrawn: new Decimal(0),
          monthlyWithdrawn: new Decimal(0),
        }),
      }),
    );
    expect(result.reference).toBe("WD-1");
  });

  it("reverses a previously successful transfer when provider later sends reversed", async () => {
    prisma.providerEvent.create.mockResolvedValue({
      id: "event-1",
      status: "PROCESSING",
    });
    prisma.transaction.findUnique.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      type: "WITHDRAW",
      status: "SUCCESS",
      amount: new Decimal(1000),
      currency: "NGN",
      reference: "WD-1",
      transferAttempts: [{ id: "attempt-1", metadata: {} }],
    });
    prisma.transaction.updateMany.mockImplementation(({ where }) =>
      Promise.resolve({
        count:
          where.status?.in?.includes("SUCCESS") || where.status === "SUCCESS"
            ? 1
            : 0,
      }),
    );
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await service.processTransferWebhook({
      provider: "monnify",
      eventType: "REVERSED_DISBURSEMENT",
      providerReference: "WD-1",
      providerStatus: "REVERSED",
      rawPayload: {
        eventType: "REVERSED_DISBURSEMENT",
        data: { reference: "WD-1", status: "REVERSED" },
      },
    });

    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", status: { in: ["PENDING", "SUCCESS"] } },
      data: { status: "REVERSED" },
    });
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        transactionId: "tx-1",
        reference: "WD-1-REVERSAL",
        source: "WITHDRAWAL_REVERSAL",
      }),
      prisma,
    );
  });
});
