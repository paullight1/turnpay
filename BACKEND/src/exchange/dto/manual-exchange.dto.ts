import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type {
  ManualAction,
  ManualPayoutOutcome,
  SettlementMode,
} from '../manual-exchange.policy';
import {
  MANUAL_ACTIONS,
  MANUAL_PAYOUT_OUTCOMES,
  MANUAL_STATUSES,
} from '../manual-exchange.policy';

export class CreateManualExchangeDto {
  @IsOptional() @IsIn(['NGN', 'GHS']) sourceCurrency?: 'NGN' | 'GHS';
  @IsString() @Matches(/^\d+(\.\d{1,2})?$/) @MaxLength(14) amount: string;
  @IsIn(['WALLET', 'BANK', 'MOMO']) settlementMode: SettlementMode;
  @ValidateIf(
    (dto: CreateManualExchangeDto) =>
      dto.settlementMode !== 'WALLET' ||
      dto.destinationInstitution !== undefined,
  )
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(2)
  @MaxLength(120)
  destinationInstitution?: string;
  @ValidateIf(
    (dto: CreateManualExchangeDto) =>
      dto.settlementMode !== 'WALLET' || dto.destinationAccount !== undefined,
  )
  @IsString()
  @Matches(/^\+?\d{7,20}$/)
  destinationAccount?: string;
  @ValidateIf(
    (dto: CreateManualExchangeDto) =>
      dto.settlementMode !== 'WALLET' || dto.destinationName !== undefined,
  )
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(2)
  @MaxLength(120)
  destinationName?: string;
  @IsString() @Matches(/^\d{4,6}$/) transactionPin: string;
}

export class ManualProofUploadDto {
  @IsString() @Matches(/^[A-Za-z0-9._ -]{1,180}$/) fileName: string;
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  contentType: string;
  @IsInt() @Min(1) @Max(8 * 1024 * 1024) fileSize: number;
}
export class AttachManualProofDto {
  @IsString() @MaxLength(300) objectKey: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9._-]{4,100}$/)
  bankReference: string;
}
export class ReviewManualExchangeDto {
  @IsIn(MANUAL_ACTIONS) action: ManualAction;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
  @ValidateIf(
    (dto: ReviewManualExchangeDto, value: unknown) =>
      dto.action === 'HANDOVER_PAYOUT' || value !== undefined,
  )
  @IsUUID()
  handoverToAdminId?: string;
  @ValidateIf(
    (dto: ReviewManualExchangeDto, value: unknown) =>
      dto.action === 'HANDOVER_PAYOUT' || value !== undefined,
  )
  @IsIn(MANUAL_PAYOUT_OUTCOMES)
  payoutOutcome?: ManualPayoutOutcome;
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{4,100}$/)
  depositReference?: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @MaxLength(14)
  actualAmount?: string;
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{4,100}$/)
  payoutReference?: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @MaxLength(14)
  payoutAmount?: string;
  @IsOptional() @IsString() @MaxLength(300) payoutProofObjectKey?: string;
  @IsOptional() @IsBoolean() acceptExpiredQuote?: boolean;
}
export class ManualExchangeQueryDto {
  @IsOptional()
  @IsIn(MANUAL_STATUSES)
  status?: (typeof MANUAL_STATUSES)[number];
}
export class ManualProofReadDto {
  @IsIn(['DEPOSIT', 'PAYOUT']) kind: 'DEPOSIT' | 'PAYOUT';
}

export class ManualQueueQueryDto extends ManualExchangeQueryDto {
  @IsOptional() @IsUUID() cursor?: string;
}
