import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { isCompensatingLedgerSource } from './settlement-hold.service';

type Client = Pick<
  Prisma.TransactionClient,
  | '$queryRaw'
  | 'ledgerEntry'
  | 'manualExchangeOrder'
  | 'exchangeReceipt'
  | 'user'
>;
type Movement = {
  userId: string;
  currency: 'NGN' | 'GHS';
  amount: Decimal;
  source: string;
};
type LockedWallet = {
  id: string;
  balance: Decimal;
  kycTier: string;
  kycStatus: string;
  isSuspended: boolean;
};
type Eligibility = Pick<LockedWallet, 'kycTier' | 'kycStatus' | 'isSuspended'>;

/** The same wallet lock covers every debit product and direct exchange reservation. */
@Injectable()
export class TierOneLimitsService {
  constructor(private readonly config: ConfigService) {}

  summary() {
    const read = (name: string) => {
      const value = this.config.get<string>(name, '');
      if (!/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
      const amount = new Decimal(value);
      return amount.isFinite() && amount.gt(0) ? amount : null;
    };
    const perTransaction = read('TIER_ONE_NGN_PER_TRANSACTION');
    const daily = read('TIER_ONE_NGN_DAILY');
    const maxBalance = read('TIER_ONE_NGN_MAX_BALANCE');
    if (!perTransaction || !daily || !maxBalance || daily.lt(perTransaction))
      return null;
    return {
      currency: 'NGN' as const,
      perTransaction: perTransaction.toFixed(2),
      daily: daily.toFixed(2),
      maxBalance: maxBalance.toFixed(2),
    };
  }

  async checkMovement(
    tx: Client,
    input: Movement,
    direction: 'DEBIT' | 'CREDIT',
  ) {
    // Compensating entries return money already owed; limits must not strand it.
    if (isCompensatingLedgerSource(input.source)) return;
    const wallet = await this.lock(tx, input);
    if (direction === 'DEBIT') this.assertOutboundEligible(wallet);
    if (wallet.kycTier !== 'TIER_1') return;
    const policy = this.requirePolicy(input.currency);
    if (direction === 'CREDIT') {
      if (new Decimal(wallet.balance).plus(input.amount).gt(policy.maxBalance))
        throw new ForbiddenException({
          code: 'KYC_BALANCE_LIMIT_EXCEEDED',
          message:
            'This credit exceeds your Tier 1 wallet balance limit. Contact support or upgrade to Tier 2.',
          limit: policy.maxBalance,
          currency: input.currency,
        });
      return;
    }
    await this.checkSpend(tx, input, wallet.id, policy);
  }

  async checkExternalExchange(tx: Client, input: Movement) {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { kycTier: true, kycStatus: true, isSuspended: true },
    });
    this.assertOutboundEligible(user);
    // External deposits do not require an existing source wallet at Tier 2.
    // Only Tier 1 reserves against the shared NGN wallet spending budget.
    if (user.kycTier !== 'TIER_1') return;
    const wallet = await this.lock(tx, input);
    this.assertOutboundEligible(wallet);
    if (wallet.kycTier !== 'TIER_1') return;
    await this.checkSpend(
      tx,
      input,
      wallet.id,
      this.requirePolicy(input.currency),
    );
  }

  private assertOutboundEligible(
    user: Eligibility | null,
  ): asserts user is Eligibility {
    if (user?.isSuspended) {
      throw new ForbiddenException(
        'Your account is under review. Contact support before making a transaction.',
      );
    }
    if (
      !user ||
      user.kycStatus !== 'VERIFIED' ||
      !['TIER_1', 'TIER_2', 'TIER_3'].includes(user.kycTier)
    ) {
      throw new ForbiddenException(
        'Verify your BVN before making a transaction',
      );
    }
  }

  private async lock(tx: Client, input: Movement) {
    const rows = await tx.$queryRaw<LockedWallet[]>(Prisma.sql`
      SELECT w."id", w."balance", u."kycTier", u."kycStatus", u."isSuspended"
      FROM "wallets" w JOIN "users" u ON u."id" = w."userId"
      WHERE w."userId" = ${input.userId} AND w."currency"::text = ${input.currency}
      FOR UPDATE OF w
    `);
    if (!rows[0])
      throw new NotFoundException(`${input.currency} wallet not found`);
    return rows[0];
  }

  private requirePolicy(currency: string) {
    const policy = currency === 'NGN' ? this.summary() : null;
    if (!policy)
      throw new ServiceUnavailableException({
        code: 'TIER_ONE_POLICY_UNAVAILABLE',
        message:
          'Tier 1 transactions are temporarily unavailable while account limits are configured.',
      });
    return policy;
  }

  private async checkSpend(
    tx: Client,
    input: Movement,
    walletId: string,
    policy: NonNullable<ReturnType<TierOneLimitsService['summary']>>,
  ) {
    const fail = (limit: string, period: string): never => {
      throw new ForbiddenException({
        code: 'KYC_LIMIT_EXCEEDED',
        message: `Your Tier 1 ${period} limit is NGN ${limit}. Use a smaller amount or upgrade to Tier 2.`,
        limit,
        currency: input.currency,
        period,
      });
    };
    if (input.amount.gt(policy.perTransaction))
      fail(policy.perTransaction, 'per transaction');
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    // Failed/reversed original transactions no longer consume the allowance.
    // Direct orders reserve at creation and retain usage until explicitly rejected.
    const [ledger, receipts, external] = await Promise.all([
      tx.ledgerEntry.aggregate({
        where: {
          walletId,
          direction: 'DEBIT',
          createdAt: { gte: day },
          transaction: { status: { notIn: ['FAILED', 'REVERSED'] } },
          source: {
            notIn: [
              'PAYSTACK_ADVERSE_RECOVERY',
              'INTERNAL_TRANSFER_REVERSAL_OUT',
            ],
          },
        },
        _sum: { amount: true },
      }),
      tx.exchangeReceipt.aggregate({
        where: {
          userId: input.userId,
          sourceCurrency: input.currency,
          status: { not: 'REJECTED' },
          createdAt: { gte: day },
        },
        _sum: { amount: true },
      }),
      tx.manualExchangeOrder.aggregate({
        where: {
          userId: input.userId,
          // Direct bank/MoMo exchange has a separate externally funded budget.
          settlementMode: 'WALLET',
          sourceCurrency: input.currency,
          status: { not: 'REJECTED' },
          createdAt: { gte: day },
        },
        _sum: { amount: true },
      }),
    ]);
    const spent = new Decimal(ledger._sum.amount ?? 0)
      .plus(external._sum.amount ?? 0)
      .plus(receipts._sum.amount ?? 0);
    if (spent.plus(input.amount).gt(policy.daily)) fail(policy.daily, 'daily');
  }
}
