import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

const SUPPORTED_CURRENCIES = ["NGN", "GHS"] as const;
const VIRTUAL_ACCOUNT_CURRENCIES = ["NGN"] as const;
const VIRTUAL_ACCOUNT_PROVIDERS = ["monnify"] as const;
const BANK_RESOLVE_PROVIDERS = ["monnify", "paystack"] as const;

export class ProvisionVirtualAccountDto {
  @IsString()
  @IsIn(VIRTUAL_ACCOUNT_CURRENCIES)
  currency: (typeof VIRTUAL_ACCOUNT_CURRENCIES)[number];

  @IsOptional()
  @IsString()
  @IsIn(VIRTUAL_ACCOUNT_PROVIDERS)
  provider?: (typeof VIRTUAL_ACCOUNT_PROVIDERS)[number];

  @IsString()
  @MaxLength(64)
  firstName: string;

  @IsString()
  @MaxLength(64)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  middleName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/)
  bvn?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/)
  nin?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/)
  identityAccountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  identityBankCode?: string;
}

export class ResolveBankAccountDto {
  @IsString()
  @Matches(/^\d{10}$/)
  accountNumber: string;

  @IsString()
  @MaxLength(20)
  bankCode: string;

  @IsOptional()
  @IsString()
  @IsIn(BANK_RESOLVE_PROVIDERS)
  provider?: (typeof BANK_RESOLVE_PROVIDERS)[number];
}

export class CreateBeneficiaryDto extends ResolveBankAccountDto {
  @IsString()
  @MaxLength(120)
  bankName: string;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];
}
