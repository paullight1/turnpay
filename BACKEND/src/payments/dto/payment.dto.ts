import {
  IsString,
  IsIn,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  MONEY_AMOUNT_PATTERN,
  normalizeDecimalInput,
} from '../../common/dto/query.dto';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;
const WITHDRAWAL_PROVIDERS = ['monnify', 'paystack'] as const;

export class WithdrawDto {
  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount must be a positive decimal with at most 2 decimal places',
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

export class AuthorizeWithdrawalDto {
  @IsString()
  @Matches(/^\d{6,8}$/)
  authorizationCode: string;
}

export class InitializePaymentDto {
  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN)
  amount: string;

  @IsString()
  @IsIn(['NGN'])
  currency: 'NGN';
}

export class PaymentReferenceDto {
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_.=-]+$/)
  reference: string;
}
