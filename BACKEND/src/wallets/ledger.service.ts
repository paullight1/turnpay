import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "../prisma/prisma.service";

type LedgerCurrency = "NGN" | "GHS";
type LedgerDirection = "DEBIT" | "CREDIT";

interface WalletMovementInput {
  userId: string;
  currency: LedgerCurrency;
  amount: Decimal;
  transactionId: string;
  reference: string;
  source: string;
  metadata?: Record<string, unknown>;
}

type LedgerClient = Pick<Prisma.TransactionClient, "wallet" | "ledgerEntry">;

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  creditWallet(input: WalletMovementInput, client?: LedgerClient) {
    return this.postWalletMovement("CREDIT", input, client);
  }

  debitWallet(input: WalletMovementInput, client?: LedgerClient) {
    return this.postWalletMovement("DEBIT", input, client);
  }

  private async postWalletMovement(
    direction: LedgerDirection,
    input: WalletMovementInput,
    client?: LedgerClient,
  ) {
    this.assertPositiveAmount(input.amount);

    const execute = async (tx: LedgerClient) => {
      let walletId: string;
      let balanceBefore: Decimal;
      let balanceAfter: Decimal;

      if (direction === "DEBIT") {
        const debited = await tx.wallet.updateMany({
          where: {
            userId: input.userId,
            currency: input.currency,
            balance: { gte: input.amount },
          },
          data: { balance: { decrement: input.amount } },
        });

        if (debited.count !== 1) {
          const wallet = await tx.wallet.findUnique({
            where: {
              userId_currency: {
                userId: input.userId,
                currency: input.currency,
              },
            },
          });

          if (!wallet) {
            throw new NotFoundException(`${input.currency} wallet not found`);
          }

          throw new BadRequestException(
            `Insufficient ${input.currency} balance`,
          );
        }

        const wallet = await tx.wallet.findUnique({
          where: {
            userId_currency: {
              userId: input.userId,
              currency: input.currency,
            },
          },
        });

        if (!wallet) {
          throw new NotFoundException(`${input.currency} wallet not found`);
        }

        walletId = wallet.id;
        balanceAfter = new Decimal(wallet.balance);
        balanceBefore = balanceAfter.plus(input.amount);
      } else {
        const existingWallet = await tx.wallet.findUnique({
          where: {
            userId_currency: {
              userId: input.userId,
              currency: input.currency,
            },
          },
        });

        if (!existingWallet) {
          throw new NotFoundException(`${input.currency} wallet not found`);
        }

        try {
          const wallet = await tx.wallet.update({
            where: {
              userId_currency: {
                userId: input.userId,
                currency: input.currency,
              },
            },
            data: { balance: { increment: input.amount } },
          });

          walletId = wallet.id;
          balanceAfter = new Decimal(wallet.balance);
          balanceBefore = balanceAfter.minus(input.amount);
        } catch (error: unknown) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025"
          ) {
            throw new NotFoundException(`${input.currency} wallet not found`);
          }

          throw error;
        }
      }

      if (balanceBefore.isNegative() || balanceAfter.isNegative()) {
        throw new BadRequestException("Wallet balance cannot be negative");
      }

      await tx.ledgerEntry.create({
        data: {
          transactionId: input.transactionId,
          walletId,
          direction,
          amount: input.amount,
          currency: input.currency,
          balanceBefore,
          balanceAfter,
          reference: input.reference,
          source: input.source,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      return {
        walletId,
        balanceBefore,
        balanceAfter,
      };
    };

    if (client) {
      return execute(client);
    }

    return this.prisma.$transaction(execute);
  }

  private assertPositiveAmount(amount: Decimal) {
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException("Amount must be positive");
    }
  }
}
