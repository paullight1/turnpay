import {
  IsString,
  IsNumber,
  IsIn,
  IsPositive,
  IsOptional,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;
const PAYMENT_CHANNELS = ['card', 'bank', 'ussd', 'mobile_money'] as const;
const PAYMENT_PROVIDERS = ['paystack', 'flutterwave'] as const;
const MAX_AMOUNT = 10_000_000;

export class FundWalletDto {
  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  @Max(MAX_AMOUNT)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsOptional()
  @IsString()
  @IsIn(PAYMENT_CHANNELS)
  channel?: (typeof PAYMENT_CHANNELS)[number];

  @IsOptional()
  @IsString()
  @IsIn(PAYMENT_PROVIDERS)
  provider?: (typeof PAYMENT_PROVIDERS)[number];

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  callbackUrl?: string;
}

export class WithdrawDto {
  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  @Max(MAX_AMOUNT)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  @IsOptional()
  beneficiaryId?: string;

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  @IsIn(PAYMENT_PROVIDERS)
  provider?: (typeof PAYMENT_PROVIDERS)[number];
}

export class ResolveBankDto {
  @IsString()
  accountNumber: string;

  @IsString()
  bankCode: string;
}
