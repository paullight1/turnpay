import { IsString, IsNumber, IsIn, IsPositive, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;
const PAYMENT_CHANNELS = ['card', 'bank', 'ussd', 'mobile_money'] as const;
const PAYMENT_PROVIDERS = ['paystack', 'flutterwave'] as const;
const MAX_AMOUNT = 10_000_000;

export class FundWalletDto {
  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  @IsIn(PAYMENT_CHANNELS)
  channel?: (typeof PAYMENT_CHANNELS)[number];

  @IsString()
  @IsIn(PAYMENT_PROVIDERS)
  provider?: (typeof PAYMENT_PROVIDERS)[number];

  @IsOptional()
  email?: string;

  @IsOptional()
  callbackUrl?: string;
}

export class WithdrawDto {
  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  bankCode: string;

  @IsString()
  accountNumber: string;

  @IsString()
  accountName: string;

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
