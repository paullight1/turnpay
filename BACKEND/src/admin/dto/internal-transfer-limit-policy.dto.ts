import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { KYCTier, WalletCurrency } from '@prisma/client';
import {
  MONEY_AMOUNT_PATTERN,
  normalizeDecimalInput,
} from '../../common/dto/query.dto';
import { AdminActionReasonDto } from './admin.dto';

const normalizeMoney = ({ value }: { value: unknown }) =>
  String(normalizeDecimalInput(value));

export class CreateInternalTransferLimitPolicyDto {
  @IsIn(['NGN', 'GHS'])
  currency: WalletCurrency;

  @IsIn(['TIER_2', 'TIER_3'])
  kycTier: KYCTier;

  @Transform(normalizeMoney)
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN)
  perTransaction: string;

  @Transform(normalizeMoney)
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN)
  daily: string;

  @Transform(normalizeMoney)
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN)
  monthly: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class ApproveInternalTransferLimitPolicyDto extends AdminActionReasonDto {}

export class InternalTransferLimitPolicyQueryDto {
  @IsOptional()
  @IsIn(['NGN', 'GHS'])
  currency?: WalletCurrency;

  @IsOptional()
  @IsIn(['TIER_2', 'TIER_3'])
  kycTier?: KYCTier;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  enabled?: boolean;
}

export class InternalTransferLimitPolicyIdParamDto {
  @IsUUID()
  policyId: string;
}
