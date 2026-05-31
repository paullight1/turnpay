import { BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";

export function toMinorUnit(amount: Decimal): number {
  const minor = amount.mul(100);

  if (!minor.isInteger() || minor.lessThanOrEqualTo(0)) {
    throw new BadRequestException("Invalid monetary amount");
  }

  if (minor.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException("Amount exceeds provider-safe range");
  }

  return minor.toNumber();
}

export function toProviderDecimalString(amount: Decimal): string {
  if (
    !amount.isFinite() ||
    amount.decimalPlaces() > 2 ||
    amount.lessThanOrEqualTo(0)
  ) {
    throw new BadRequestException("Invalid monetary amount");
  }

  return amount.toFixed(2);
}

export function fromMinorUnit(amount: number | string): Decimal {
  return new Decimal(amount).div(100);
}
