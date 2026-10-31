import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export function toMinorUnit(amount: Decimal): number {
  const minor = amount.mul(100);

  if (!minor.isInteger() || minor.lessThanOrEqualTo(0)) {
    throw new BadRequestException('Invalid monetary amount');
  }

  if (minor.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException('Amount exceeds provider-safe range');
  }

  return minor.toNumber();
}

export function toProviderDecimalString(amount: Decimal): string {
  if (
    !amount.isFinite() ||
    amount.decimalPlaces() > 2 ||
    amount.lessThanOrEqualTo(0)
  ) {
    throw new BadRequestException('Invalid monetary amount');
  }

  return amount.toFixed(2);
}

export function fromMinorUnit(
  amount: number | string,
  allowZero = false,
): Decimal {
  const minor = new Decimal(amount);
  if (
    !minor.isFinite() ||
    !minor.isInteger() ||
    minor.lt(allowZero ? 0 : 1) ||
    minor.gt(Number.MAX_SAFE_INTEGER)
  )
    throw new BadRequestException('Invalid provider monetary amount');
  return minor.div(100);
}
