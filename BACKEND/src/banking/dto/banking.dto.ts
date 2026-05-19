import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;
const BANKING_PROVIDERS = ['paystack'] as const;

export class ProvisionVirtualAccountDto {
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsOptional()
  @IsString()
  @IsIn(BANKING_PROVIDERS)
  provider?: (typeof BANKING_PROVIDERS)[number];

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional()
  @IsString()
  bvn?: string;

  @IsOptional()
  @IsString()
  identityAccountNumber?: string;

  @IsOptional()
  @IsString()
  identityBankCode?: string;
}

export class ResolveBankAccountDto {
  @IsString()
  accountNumber: string;

  @IsString()
  bankCode: string;

  @IsOptional()
  @IsString()
  @IsIn(BANKING_PROVIDERS)
  provider?: (typeof BANKING_PROVIDERS)[number];
}

export class CreateBeneficiaryDto extends ResolveBankAccountDto {
  @IsString()
  bankName: string;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];
}
