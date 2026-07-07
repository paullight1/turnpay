import { Decimal } from "@prisma/client/runtime/library";
import { PaymentService } from "./payment.service";

describe("PaymentService.reconcilePendingWithdrawals", () => {
  const prisma = {
    transaction: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    transferAttempt: {
      update: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
    },
    user: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const monnifyBanks = {
    getTransferStatus: jest.fn(),
  };
  const config = { get: jest.fn(() => undefined) };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const ledger = { creditWallet: jest.fn(), debitWallet: jest.fn() };

  let service: PaymentService;

  const makeWithdrawal = (id: string, userId: string, reference: string) => ({
    id,
    userId,
    reference,
    amount: new Decimal(1000),
    currency: "NGN",
    status: "PENDING",
    metadata: null,
    transferAttempts: [
      {
        id: `att-${id}`,
        provider: "MONNIFY",
        providerReference: reference,
        providerStatus: "PENDING",
        status: "PENDING",
        attemptNo: 1,
        lastCheckedAt: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      monnifyBanks as any,
      config as any,
      logger as any,
      {} as any,
      ledger as any,
      {} as any,
    );
  });

  it("resolves withdrawals the provider reports terminal and leaves still-pending ones alone", async () => {
    prisma.transaction.findMany.mockResolvedValue([
      makeWithdrawal("tx-1", "u1", "WD-1"),
      makeWithdrawal("tx-2", "u2", "WD-2"),
    ]);
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.transferAttempt.update.mockResolvedValue({});
    monnifyBanks.getTransferStatus.mockImplementation((reference: string) =>
      reference === "WD-1"
        ? Promise.resolve({ reference: "WD-1", status: "SUCCESS" })
        : Promise.resolve({ reference: "WD-2", status: "PENDING" }),
    );

    const result = await service.reconcilePendingWithdrawals(25);

    expect(result).toEqual({ checked: 2, resolved: 1 });
    expect(monnifyBanks.getTransferStatus).toHaveBeenCalledTimes(2);
  });

  it("reverses funds when the provider reports the transfer failed", async () => {
    prisma.transaction.findMany.mockResolvedValue([
      makeWithdrawal("tx-3", "u3", "WD-3"),
    ]);
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.transferAttempt.update.mockResolvedValue({});
    prisma.ledgerEntry.findFirst.mockResolvedValue(null); // no prior reversal
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    monnifyBanks.getTransferStatus.mockResolvedValue({
      reference: "WD-3",
      status: "FAILED",
    });

    const result = await service.reconcilePendingWithdrawals(25);

    expect(result).toEqual({ checked: 1, resolved: 1 });
    expect(ledger.creditWallet).toHaveBeenCalledTimes(1);
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u3",
        source: "WITHDRAWAL_REVERSAL",
        reference: "WD-3-REVERSAL",
      }),
      expect.anything(),
    );
  });

  it("continues the batch when one withdrawal reconciliation throws", async () => {
    prisma.transaction.findMany.mockResolvedValue([
      makeWithdrawal("tx-4", "u4", "WD-4"),
      makeWithdrawal("tx-5", "u5", "WD-5"),
    ]);
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.transferAttempt.update.mockResolvedValue({});
    monnifyBanks.getTransferStatus.mockResolvedValue({
      reference: "WD",
      status: "SUCCESS",
    });
    // First item's DB transition explodes; second must still be processed.
    prisma.$transaction
      .mockImplementationOnce(async () => {
        throw new Error("db blip");
      })
      .mockImplementation(async (fn: any) => fn(prisma));

    const result = await service.reconcilePendingWithdrawals(25);

    expect(result.checked).toBe(2);
    expect(result.resolved).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });
});
