import {
  IsString,
  IsIn,
  IsOptional,
  Matches,
  MaxLength,
} from "class-validator";
import { Transform } from "class-transformer";
import {
  MONEY_AMOUNT_PATTERN,
  normalizeDecimalInput,
} from "../../common/dto/query.dto";

const SUPPORTED_CURRENCIES = ["NGN", "GHS"] as const;
const PAYMENT_CHANNELS = ["card", "bank", "ussd", "mobile_money"] as const;
const PAYMENT_PROVIDERS = ["paystack", "flutterwave"] as const;
const WITHDRAWAL_PROVIDERS = ["monnify"] as const;

export class FundWalletDto {
  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: "amount must be a positive decimal with at most 2 decimal places",
  })
  amount: string;

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
  @MaxLength(254)
  email?: string;
}

export class WithdrawDto {
  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: "amount must be a positive decimal with at most 2 decimal places",
  })
  amount: string;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  @IsOptional()
  beneficiaryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @IsOptional()
  @IsString()
  @IsIn(WITHDRAWAL_PROVIDERS)
  provider?: (typeof WITHDRAWAL_PROVIDERS)[number];

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/)
  transactionPin?: string;
}

export class ResolveBankDto {
  @IsString()
  @Matches(/^\d{10}$/)
  accountNumber: string;

  @IsString()
  @MaxLength(32)
  bankCode: string;
}
