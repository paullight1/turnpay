import { FundingAdverseCaseStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class PaystackAdverseCaseQueryDto {
  @IsOptional()
  @IsEnum(FundingAdverseCaseStatus)
  status?: FundingAdverseCaseStatus;
}

export class ResolvePaystackAdverseCaseDto {
  @IsIn(['RELEASE_HOLD', 'COLLECT'])
  action!: 'RELEASE_HOLD' | 'COLLECT';

  @IsString()
  @Length(10, 500)
  reason!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,13}(?:\.\d{1,2})?$/)
  amount?: string;
}

export class RecheckPaystackAdverseCaseDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}
