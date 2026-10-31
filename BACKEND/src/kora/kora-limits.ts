import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export async function reserveCurrencyLimit(
  tx: Prisma.TransactionClient,
  config: ConfigService,
  userId: string,
  currency: 'NGN' | 'GHS',
  amount: Decimal,
) {
  // Serialize all currency-usage reservations for this customer, including different order keys.
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const now = new Date();
  const day = now.toISOString().slice(0, 10),
    month = day.slice(0, 7);
  if (currency === 'NGN') {
    const daily =
      user.dailyLimitResetDate?.toISOString().slice(0, 10) === day
        ? user.dailyWithdrawn
        : new Decimal(0);
    const monthly =
      user.limitResetDate && user.limitResetDate > now
        ? user.monthlyWithdrawn
        : new Decimal(0);
    if (
      daily.plus(amount).gt(user.dailyWithdrawLimit) ||
      monthly.plus(amount).gt(user.monthlyWithdrawLimit)
    )
      throw new BadRequestException('Withdrawal limit exceeded');
    await tx.user.update({
      where: { id: userId },
      data: {
        dailyWithdrawn: daily.plus(amount),
        monthlyWithdrawn: monthly.plus(amount),
        dailyLimitResetDate: new Date(`${day}T00:00:00.000Z`),
        limitResetDate: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        ),
      },
    });
    return;
  }
  const dailyText = config.get<string>('KORA_GHS_DAILY_LIMIT', '0'),
    monthlyText = config.get<string>('KORA_GHS_MONTHLY_LIMIT', '0');
  if (
    !/^\d+(\.\d{1,2})?$/.test(dailyText) ||
    !/^\d+(\.\d{1,2})?$/.test(monthlyText)
  )
    throw new ServiceUnavailableException(
      'Ghana transfer limits are not configured',
    );
  const dailyLimit = new Decimal(dailyText),
    monthlyLimit = new Decimal(monthlyText);
  if (dailyLimit.lte(0) || monthlyLimit.lt(dailyLimit))
    throw new ServiceUnavailableException(
      'Ghana transfer limits are not configured',
    );
  const usage = await tx.currencyLimitUsage.findUnique({
    where: { userId_currency_day: { userId, currency, day } },
  });
  const total = await tx.currencyLimitUsage.aggregate({
    where: { userId, currency, month },
    _sum: { amount: true },
  });
  if (
    (usage?.amount ?? new Decimal(0)).plus(amount).gt(dailyLimit) ||
    (total._sum.amount ?? new Decimal(0)).plus(amount).gt(monthlyLimit)
  )
    throw new BadRequestException(
      'Ghana daily or monthly transfer limit exceeded',
    );
  await tx.currencyLimitUsage.upsert({
    where: { userId_currency_day: { userId, currency, day } },
    create: { userId, currency, day, month, amount },
    update: { amount: { increment: amount } },
  });
}
