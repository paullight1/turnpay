import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  PrismaClient,
  type InternalTransferLimitPolicy,
  type WalletCurrency,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../../src/wallets/ledger.service';
import { InternalTransferIdempotencyService } from '../../src/transfers/internal-transfer-idempotency.service';
import { InternalTransferLimitService } from '../../src/transfers/internal-transfer-limit.service';
import { InternalTransferReversalService } from '../../src/transfers/internal-transfer-reversal.service';
import { TransfersService } from '../../src/transfers/transfers.service';
import { TransferPostCommitHook } from '../../src/transfers/transfer-post-commit.hook';

export type FinancialTransferFixture = Awaited<
  ReturnType<typeof createFinancialTransferFixture>
>;

export function requireFinancialTestDatabaseUrl() {
  const databaseUrl = process.env.FINANCIAL_TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'FINANCIAL_TEST_DATABASE_URL is required for real financial E2E tests',
    );
  }
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!/^trustpay_financial_test(?:_|$)/.test(databaseName)) {
    throw new Error(
      `Refusing financial E2E against non-disposable database ${databaseName}`,
    );
  }
  process.env.DATABASE_URL = databaseUrl;
  return databaseUrl;
}

export function createFinancialTestPrisma() {
  requireFinancialTestDatabaseUrl();
  return new PrismaClient();
}

export async function createFinancialTransferFixture(
  prisma: PrismaClient,
  options: {
    senderBalance?: string;
    recipientBalance?: string;
    createRecipientGhsWallet?: boolean;
    createPolicies?: boolean;
  } = {},
) {
  const fixtureId = randomUUID();
  const prefix = `financial-${fixtureId}`;
  const password = 'financial-test-noncredential';
  const userRows = [
    { key: 'sender', role: 'USER' as const },
    { key: 'recipientA', role: 'USER' as const },
    { key: 'recipientB', role: 'USER' as const },
    { key: 'requesterAdmin', role: 'ADMIN' as const },
    { key: 'approverAdminA', role: 'ADMIN' as const },
    { key: 'approverAdminB', role: 'ADMIN' as const },
  ] as const;
  const phoneSeed = createHash('sha256')
    .update(fixtureId)
    .digest('hex')
    .replace(/\D/g, '')
    .padEnd(10, '0')
    .slice(0, 9);

  const users = Object.fromEntries(
    await Promise.all(
      userRows.map(async ({ key, role }, index) => {
        const user = await prisma.user.create({
          data: {
            id: `${prefix}-${key}`,
            email: `${fixtureId}.${key}@financial.test`,
            phone: `+234${phoneSeed}${index}`,
            fullName: `Financial ${key}`,
            password,
            role,
            kycStatus: 'VERIFIED',
            kycTier: 'TIER_2',
          },
        });
        return [key, user] as const;
      }),
    ),
  ) as Record<
    (typeof userRows)[number]['key'],
    Awaited<ReturnType<typeof prisma.user.create>>
  >;

  const balances: Record<string, string> = {
    sender: options.senderBalance ?? '1000.00',
    recipientA: options.recipientBalance ?? '100.00',
    recipientB: options.recipientBalance ?? '100.00',
    requesterAdmin: '0.00',
    approverAdminA: '0.00',
    approverAdminB: '0.00',
  };
  const walletRows: Array<{
    userKey: keyof typeof users;
    currency: WalletCurrency;
    balance: string;
  }> = [];
  for (const userKey of Object.keys(users) as Array<keyof typeof users>) {
    walletRows.push({ userKey, currency: 'NGN', balance: balances[userKey] });
    if (
      userKey !== 'recipientA' ||
      options.createRecipientGhsWallet !== false
    ) {
      walletRows.push({ userKey, currency: 'GHS', balance: balances[userKey] });
    }
  }
  const wallets = await Promise.all(
    walletRows.map(({ userKey, currency, balance }) =>
      prisma.wallet.create({
        data: {
          id: `${prefix}-${userKey}-${currency}`,
          userId: users[userKey].id,
          currency,
          balance: new Decimal(balance),
        },
      }),
    ),
  );

  const policies: InternalTransferLimitPolicy[] = [];
  if (options.createPolicies !== false) {
    const versionBase = randomInt(2, 2_000_000_000);
    policies.push(
      ...(await Promise.all(
        (['NGN', 'GHS'] as const).map((currency, index) =>
          prisma.internalTransferLimitPolicy.create({
            data: {
              id: `${prefix}-policy-${currency}`,
              currency,
              kycTier: 'TIER_2',
              perTransaction: new Decimal('1000000.00'),
              daily: new Decimal('2000000.00'),
              monthly: new Decimal('10000000.00'),
              enabled: true,
              version: versionBase + index,
              reason: `Financial E2E fixture ${fixtureId}`,
              effectiveFrom: new Date(0),
            },
          }),
        ),
      )),
    );
  }

  return {
    fixtureId,
    prefix,
    users,
    wallets,
    policies,
    context(key: string) {
      return {
        idempotencyKey: `${prefix}-${key}`,
        requestId: `${prefix}-request-${key}`,
        ipAddress: '127.0.0.1',
        userAgent: 'trustpay-financial-e2e',
      };
    },
  };
}

export function createRealTransferServices(
  prisma: PrismaClient,
  options: {
    postCommitHook?: TransferPostCommitHook;
    pinVerifier?: object;
  } = {},
) {
  const ledger = new LedgerService(prisma as never);
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const pinVerifier = options.pinVerifier ?? {
    verifyRequired: jest.fn().mockResolvedValue(undefined),
  };
  const idempotency = new InternalTransferIdempotencyService(prisma as never);
  const limits = new InternalTransferLimitService(prisma as never);
  const postCommitHook = options.postCommitHook ?? new TransferPostCommitHook();
  const transfers = new TransfersService(
    prisma as never,
    ledger,
    logger as never,
    pinVerifier as never,
    idempotency,
    limits,
    postCommitHook,
  );
  const reversals = new InternalTransferReversalService(
    prisma as never,
    ledger,
    logger as never,
  );
  return { transfers, reversals, ledger, logger, idempotency, limits };
}

export async function cleanupFinancialTransferFixture(
  prisma: PrismaClient,
  fixture: FinancialTransferFixture,
) {
  const userIds = Object.values(fixture.users).map(({ id }) => id);
  const walletIds = fixture.wallets.map(({ id }) => id);
  const fundingTransactions = await prisma.transaction.findMany({
    where: { userId: { in: userIds }, type: 'FUND' },
    select: { reference: true },
  });
  const attempts = await prisma.internalTransferAttempt.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, transferReference: true },
  });
  const attemptIds = attempts.map(({ id }) => id);
  const references = attempts
    .map(({ transferReference }) => transferReference)
    .filter((value): value is string => Boolean(value));

  await prisma.$transaction([
    prisma.exchangeDepositAllocation.deleteMany({
      where: {
        reference: {
          in: fundingTransactions.map((row) =>
            row.reference.trim().toUpperCase(),
          ),
        },
      },
    }),
    prisma.auditLog.deleteMany({
      where: {
        OR: [
          { adminId: { in: userIds } },
          { targetId: { in: attemptIds } },
          { reference: { in: references } },
        ],
      },
    }),
    prisma.internalTransferReversal.deleteMany({
      where: { originalAttemptId: { in: attemptIds } },
    }),
    prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } }),
    prisma.transaction.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.internalTransferAttempt.deleteMany({
      where: { id: { in: attemptIds } },
    }),
    prisma.internalTransferLimitUsage.deleteMany({
      where: { userId: { in: userIds } },
    }),
    prisma.transactionPinCredential.deleteMany({
      where: { userId: { in: userIds } },
    }),
    prisma.wallet.deleteMany({ where: { id: { in: walletIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    prisma.internalTransferLimitPolicy.deleteMany({
      where: { id: { in: fixture.policies.map(({ id }) => id) } },
    }),
  ]);
}

export async function walletBalance(
  prisma: PrismaClient,
  userId: string,
  currency: WalletCurrency,
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId_currency: { userId, currency } },
  });
  return new Decimal(wallet.balance);
}
