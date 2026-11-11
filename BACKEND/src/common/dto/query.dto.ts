import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;
export const TRANSACTION_STATUSES = [
  'PENDING',
  'SUCCESS',
  'FAILED',
  'REVERSED',
] as const;
export const TRANSACTION_TYPES = [
  'EXCHANGE',
  'FUND',
  'WITHDRAW',
  'INTERNAL_TRANSFER',
  'AIRTIME',
  'DATA',
  'CABLE',
  'ELECTRICITY',
] as const;

export const MONEY_AMOUNT_PATTERN =
  /^(?:0\.(?:0[1-9]|[1-9]\d)|[1-9]\d{0,9}(?:\.\d{1,2})?)$/;

export function normalizeDecimalInput(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value.toFixed(2).replace(/\.00$/, '')
      : value;
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
}

export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class LimitQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 50))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class TransactionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(TRANSACTION_STATUSES)
  status?: (typeof TRANSACTION_STATUSES)[number];

  @IsOptional()
  @IsString()
  @IsIn(TRANSACTION_TYPES)
  type?: (typeof TRANSACTION_TYPES)[number];
}

export class ReferenceParamDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{6,120}$/)
  reference!: string;
}
