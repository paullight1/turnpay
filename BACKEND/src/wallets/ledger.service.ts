import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

type LedgerCurrency = 'NGN' | 'GHS';
type LedgerDirection = 'DEBIT' | 'CREDIT';

interface WalletMovementInput {
  userId: string;
  currency: LedgerCurrency;
  amount: Decimal;
  transactionId: string;
  reference: string;
  source: string;
  metadata?: Record<string, unknown>;
}

type LedgerClient = Pick<Prisma.TransactionClient, 'wallet' | 'ledgerEntry'>;

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  creditWallet(input: WalletMovementInput, client?: LedgerClient) {
    return this.postWalletMovement('CREDIT', input, client);
  }

  debitWallet(input: WalletMovementInput, client?: LedgerClient) {
    return this.postWalletMovement('DEBIT', input, client);
  }

  private async postWalletMovement(
    direction: LedgerDirection,
    input: WalletMovementInput,
    client?: LedgerClient,
  ) {
    this.assertPositiveAmount(input.amount);

    const execute = async (tx: LedgerClient) => {
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

      const balanceBefore = new Decimal(wallet.balance);

      if (direction === 'DEBIT' && balanceBefore.lessThan(input.amount)) {
        throw new BadRequestException(`Insufficient ${input.currency} balance`);
      }

      const balanceAfter =
        direction === 'CREDIT'
          ? balanceBefore.plus(input.amount)
          : balanceBefore.minus(input.amount);

      if (balanceAfter.isNegative()) {
        throw new BadRequestException('Wallet balance cannot be negative');
      }

      if (direction === 'DEBIT') {
        const debited = await tx.wallet.updateMany({
          where: {
            id: wallet.id,
            balance: { gte: input.amount },
          },
          data: { balance: { decrement: input.amount } },
        });

        if (debited.count !== 1) {
          throw new BadRequestException(
            `Insufficient ${input.currency} balance`,
          );
        }
      } else {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: input.amount } },
        });
      }

      await tx.ledgerEntry.create({
        data: {
          transactionId: input.transactionId,
          walletId: wallet.id,
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
        walletId: wallet.id,
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
      throw new BadRequestException('Amount must be positive');
    }
  }
}
