import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { TierOneLimitsService } from '../common/services/tier-one-limits.service';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import {
  isCompensatingLedgerSource,
  SettlementHoldService,
  settlementOperationForSource,
} from '../common/services/settlement-hold.service';
import { enqueueWalletMovementEmail } from '../notifications/financial-notifications';

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

type LedgerClient = Pick<
  Prisma.TransactionClient,
  | 'user'
  | 'wallet'
  | 'ledgerEntry'
  | 'manualExchangeOrder'
  | 'exchangeReceipt'
  | 'reconciliationRun'
  | 'auditLog'
  | 'emailOutbox'
  | '$queryRaw'
>;

@Injectable()
export class LedgerService {
  private readonly settlementHold: SettlementHoldService;
  private readonly tierOneLimits: TierOneLimitsService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() settlementHold?: SettlementHoldService,
    @Optional() tierOneLimits?: TierOneLimitsService,
  ) {
    // The application module always supplies this provider. The fallback
    // keeps direct service tests honest: they exercise the same persisted
    // hold check instead of silently disabling it when a fixture omits DI.
    this.settlementHold = settlementHold ?? new SettlementHoldService(prisma);
    this.tierOneLimits =
      tierOneLimits ?? new TierOneLimitsService(new ConfigService());
  }

  creditWallet(input: WalletMovementInput, client?: LedgerClient) {
    return this.postWalletMovement('CREDIT', input, client);
  }

  debitWallet(input: WalletMovementInput, client?: LedgerClient) {
    return this.postWalletMovement('DEBIT', input, client);
  }

  creditPaystackDepositWithFee(
    input: WalletMovementInput,
    fee: Decimal,
    client: LedgerClient,
  ) {
    this.assertPositiveAmount(fee);
    if (
      input.source !== 'PAYSTACK_DVA' ||
      input.currency !== 'NGN' ||
      fee.gte(input.amount)
    ) {
      throw new BadRequestException('Invalid Paystack deposit service charge');
    }
    // Apply only the net credit to spendable funds. The fee is part of this
    // incoming deposit, so it never debits the customer's existing funds.
    return this.postWalletMovement('CREDIT', input, client, false, fee);
  }

  /**
   * Explicit operator-approved recovery is the only debit allowed to proceed
   * while an adverse-funding case is being resolved. The caller must already
   * be inside the audited serializable case transaction; normal debit callers
   * have no flag that can accidentally bypass the global hold.
   */
  debitWalletForAdverseFunding(
    input: WalletMovementInput,
    client: LedgerClient,
  ) {
    return this.postWalletMovement('DEBIT', input, client, true);
  }

  private async postWalletMovement(
    direction: LedgerDirection,
    input: WalletMovementInput,
    client?: LedgerClient,
    adverseFundingResolution = false,
    depositFee?: Decimal,
  ) {
    this.assertPositiveAmount(input.amount);

    const execute = async (tx: LedgerClient) => {
      if (direction === 'DEBIT' && !isCompensatingLedgerSource(input.source)) {
        await this.settlementHold.assertOutboundAllowed(
          {
            operation: settlementOperationForSource(input.source),
            userId: input.userId,
            currency: input.currency,
            reference: input.reference,
            skipAdverseFundingHold: adverseFundingResolution,
          },
          tx,
        );

        // The PIN reset endpoint and this debit must serialize on the same
        // credential row. A check performed before entering the ledger
        // transaction can race a reset that publishes a new credential and
        // reset hold while this debit is in flight.
        const credentials = await tx.$queryRaw<
          Array<{ resetHoldUntil: Date | null }>
        >`
          SELECT "resetHoldUntil"
          FROM "transaction_pin_credentials"
          WHERE "userId" = ${input.userId}
          FOR SHARE
        `;
        const resetHoldUntil = credentials[0]?.resetHoldUntil;
        if (resetHoldUntil && resetHoldUntil > new Date()) {
          throw new ForbiddenException(
            'Transaction PIN was recently reset; money movement is temporarily locked',
          );
        }
      }

      const walletAmount = depositFee
        ? input.amount.minus(depositFee)
        : input.amount;
      if (!adverseFundingResolution) {
        await this.tierOneLimits.checkMovement(
          tx,
          { ...input, amount: walletAmount },
          direction,
        );
      }

      let walletId: string;
      let balanceBefore: Decimal;
      let balanceAfter: Decimal;

      if (direction === 'DEBIT') {
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
            data: { balance: { increment: walletAmount } },
          });

          walletId = wallet.id;
          balanceAfter = new Decimal(wallet.balance);
          balanceBefore = balanceAfter.minus(walletAmount);
        } catch (error: unknown) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2025'
          ) {
            throw new NotFoundException(`${input.currency} wallet not found`);
          }

          throw error;
        }
      }

      if (balanceBefore.isNegative() || balanceAfter.isNegative()) {
        throw new BadRequestException('Wallet balance cannot be negative');
      }

      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          transactionId: input.transactionId,
          walletId,
          direction,
          amount: input.amount,
          currency: input.currency,
          balanceBefore,
          balanceAfter: depositFee
            ? balanceAfter.plus(depositFee)
            : balanceAfter,
          reference: input.reference,
          source: input.source,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      if (depositFee) {
        await tx.ledgerEntry.create({
          data: {
            transactionId: input.transactionId,
            walletId,
            direction: 'DEBIT',
            amount: depositFee,
            currency: input.currency,
            balanceBefore: balanceAfter.plus(depositFee),
            balanceAfter,
            reference: input.reference,
            source: 'PAYSTACK_DVA_SERVICE_CHARGE',
          },
        });
      }

      // Paystack/DVA deposits already enqueue the established branded deposit
      // event. Keeping those sources out of the generic movement stream avoids
      // sending two confirmations for one committed funding transaction.
      if (!usesExistingDepositEmail(input.source)) {
        await enqueueWalletMovementEmail(tx, {
          userId: input.userId,
          ledgerEntryId: ledgerEntry.id,
          direction,
        });
      }

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
      throw new BadRequestException('Amount must be positive');
    }
  }
}

function usesExistingDepositEmail(source: string): boolean {
  const normalized = source.toUpperCase();
  return normalized === 'PAYSTACK_CHECKOUT' || normalized.endsWith('_DVA');
}
