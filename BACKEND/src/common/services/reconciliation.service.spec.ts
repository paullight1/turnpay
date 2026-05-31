import { Decimal } from "@prisma/client/runtime/library";
import { ReconciliationService } from "./reconciliation.service";

describe("ReconciliationService", () => {
  const prisma = {
    wallet: {
      findMany: jest.fn(),
    },
  };
  const pinoLogger = {
    info: jest.fn(),
    error: jest.fn(),
  };

  let service: ReconciliationService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ReconciliationService(prisma as any, pinoLogger as any);
  });

  it("derives expected wallet balances from ledger entries", async () => {
    prisma.wallet.findMany.mockResolvedValue([
      {
        id: "wallet-1",
        userId: "user-1",
        currency: "NGN",
        balance: new Decimal("800.00"),
        ledgerEntries: [
          {
            direction: "CREDIT",
            amount: new Decimal("1000.00"),
            currency: "NGN",
          },
          {
            direction: "DEBIT",
            amount: new Decimal("200.00"),
            currency: "NGN",
          },
          {
            direction: "CREDIT",
            amount: new Decimal("500.00"),
            currency: "GHS",
          },
        ],
      },
    ]);

    const result = await service.reconcileWallets();

    expect(prisma.wallet.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        userId: true,
        currency: true,
        balance: true,
        ledgerEntries: {
          select: {
            direction: true,
            amount: true,
            currency: true,
          },
        },
      },
    });
    expect(result).toMatchObject({
      totalChecked: 1,
      mismatches: [],
    });
  });

  it("reports wallet balance drift using Decimal-formatted values", async () => {
    prisma.wallet.findMany.mockResolvedValue([
      {
        id: "wallet-1",
        userId: "user-1",
        currency: "NGN",
        balance: new Decimal("799.50"),
        ledgerEntries: [
          {
            direction: "CREDIT",
            amount: new Decimal("1000.00"),
            currency: "NGN",
          },
          {
            direction: "DEBIT",
            amount: new Decimal("200.00"),
            currency: "NGN",
          },
        ],
      },
    ]);

    const result = await service.reconcileWallets();

    expect(result.mismatches).toEqual([
      {
        walletId: "wallet-1",
        userId: "user-1",
        currency: "NGN",
        expectedBalance: "800.00",
        actualBalance: "799.50",
        difference: "0.50",
      },
    ]);
  });
});
