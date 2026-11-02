import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { LedgerService } from '../src/wallets/ledger.service';
import { TierOneLimitsService } from '../src/common/services/tier-one-limits.service';
import {
  cleanupFinancialTransferFixture,
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  type FinancialTransferFixture,
} from './support/transfer-fixtures';

describe('BVN Tier 1 limits (isolated PostgreSQL)', () => {
  let db: PrismaClient;
  let fixture: FinancialTransferFixture;
  let ledger: LedgerService;
  beforeAll(async () => {
    db = createFinancialTestPrisma();
    await db.$connect();
  });
  beforeEach(async () => {
    fixture = await createFinancialTransferFixture(db, {
      senderBalance: '300.00',
      createPolicies: false,
    });
    await db.user.update({
      where: { id: fixture.users.sender.id },
      data: { kycTier: 'TIER_1' },
    });
    ledger = new LedgerService(
      db as never,
      undefined,
      new TierOneLimitsService(
        new ConfigService({
          TIER_ONE_NGN_PER_TRANSACTION: '150',
          TIER_ONE_NGN_DAILY: '200',
          TIER_ONE_NGN_MAX_BALANCE: '300',
        }),
      ),
    );
  });
  afterEach(async () => {
    if (fixture) await cleanupFinancialTransferFixture(db, fixture);
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  async function debit(source: string, amount = '120') {
    return db.$transaction(async (tx) => {
      const reference = `tier-one-${randomUUID()}`;
      const transaction = await tx.transaction.create({
        data: {
          userId: fixture.users.sender.id,
          type: 'WITHDRAW',
          amount,
          currency: 'NGN',
          reference,
          status: 'PENDING',
        },
      });
      await ledger.debitWallet(
        {
          userId: fixture.users.sender.id,
          currency: 'NGN',
          amount: new Decimal(amount),
          transactionId: transaction.id,
          reference,
          source,
        },
        tx,
      );
      return transaction;
    });
  }

  it('serializes simultaneous withdrawal and bill spending against one daily allowance', async () => {
    const results = await Promise.allSettled([
      debit('WITHDRAWAL'),
      debit('VTU_PURCHASE'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const wallet = await db.wallet.findUniqueOrThrow({
      where: {
        userId_currency: { userId: fixture.users.sender.id, currency: 'NGN' },
      },
    });
    expect(wallet.balance.toFixed(2)).toBe('180.00');
    expect(
      await db.ledgerEntry.count({
        where: { walletId: wallet.id, direction: 'DEBIT' },
      }),
    ).toBe(1);
  });

  it('keeps an uncredited receipt pending for reconciliation when its balance cap is exceeded', async () => {
    const reference = `tier-one-${randomUUID()}`;
    const transaction = await db.transaction.create({
      data: {
        userId: fixture.users.sender.id,
        type: 'FUND',
        currency: 'NGN',
        amount: '10',
        reference,
        status: 'PENDING',
      },
    });
    await expect(
      ledger.creditWallet({
        userId: fixture.users.sender.id,
        currency: 'NGN',
        amount: new Decimal(10),
        transactionId: transaction.id,
        reference,
        source: 'PAYSTACK_CHECKOUT',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'KYC_BALANCE_LIMIT_EXCEEDED' }),
    });
    expect(
      (
        await db.transaction.findUniqueOrThrow({
          where: { id: transaction.id },
        })
      ).status,
    ).toBe('PENDING');
    expect(
      await db.ledgerEntry.count({ where: { transactionId: transaction.id } }),
    ).toBe(0);
  });

  it('a failed original debit releases its daily allowance before an exactly-once refund', async () => {
    const original = await debit('WITHDRAWAL');
    await db.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: original.id },
        data: { status: 'FAILED' },
      });
      await ledger.creditWallet(
        {
          userId: fixture.users.sender.id,
          currency: 'NGN',
          amount: new Decimal(120),
          transactionId: original.id,
          reference: original.reference,
          source: 'WITHDRAWAL_REVERSAL',
        },
        tx,
      );
    });
    await expect(debit('VTU_PURCHASE')).resolves.toMatchObject({
      status: 'PENDING',
    });
  });
});
