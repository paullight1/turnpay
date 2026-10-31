import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { isKycTierAtLeast } from '../common/utils/kyc-tier';

export async function eligibleKoraUser(
  db: Prisma.TransactionClient | PrismaService,
  userId: string,
  tier: 'TIER_1' | 'TIER_2' = 'TIER_2',
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    user.isSuspended ||
    user.kycStatus !== 'VERIFIED' ||
    !isKycTierAtLeast(user.kycTier, tier)
  )
    throw new ForbiddenException(
      `A verified ${tier.replace('_', ' ')} account is required`,
    );
  return user;
}
export async function serialMoney<T>(
  db: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: 'Serializable',
        timeout: 5000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2034' ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new ConflictException(
    'Payment is being processed. Refresh its status.',
  );
}
export async function fundExchangeOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  reference: string,
) {
  const order = await tx.providerExchangeOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { quote: true },
  });
  const claimed = await tx.providerExchangeOrder.updateMany({
    where: { id: orderId, fundedAt: null, status: 'AWAITING_PAYMENT' },
    data: {
      fundedAt: new Date(),
      fundingReference: reference,
      status: order.quote.expiresAt < new Date() ? 'NEEDS_REVIEW' : 'READY',
    },
  });
  if (claimed.count !== 1)
    throw new ConflictException('Exchange funding is already recorded');
  await tx.exchangeTreasuryEntry.createMany({
    data: [
      {
        orderId,
        currency: order.quote.sourceCurrency,
        kind: 'SOURCE_RECEIVED',
        amount: order.quote.total,
      },
      {
        orderId,
        currency: order.quote.targetCurrency,
        kind: 'DESTINATION_OWED',
        amount: order.quote.targetAmount,
      },
      ...(order.quote.fee.gt(0)
        ? [
            {
              orderId,
              currency: order.quote.sourceCurrency,
              kind: 'SOURCE_FEE',
              amount: order.quote.fee,
            },
          ]
        : []),
    ],
  });
  await tx.paymentNotification.create({
    data: {
      eventKey: `exchange-funded:${orderId}`,
      orderId,
      title: `Money confirmed: ${order.quote.targetCurrency} payout ready`,
    },
  });
}
export function nonnegativeProviderFee(value: unknown): Decimal {
  const text =
    value === undefined
      ? '0'
      : typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '';
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text))
    throw new ConflictException('Provider fee needs reconciliation');
  return new Decimal(text);
}
