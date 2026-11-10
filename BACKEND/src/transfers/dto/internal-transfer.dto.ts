import {
  IsIn,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  MONEY_AMOUNT_PATTERN,
  normalizeDecimalInput,
} from '../../common/dto/query.dto';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;

export class InternalTransferDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/)
  recipientAccountNumber?: string;

  @ValidateIf(
    (dto: InternalTransferDto) => !dto.recipientEmail && !dto.recipientPhone,
  )
  @IsOptional()
  @IsString()
  recipientId?: string;

  @ValidateIf(
    (dto: InternalTransferDto) => !dto.recipientId && !dto.recipientPhone,
  )
  @IsOptional()
  @IsEmail()
  @IsString()
  recipientEmail?: string;

  @ValidateIf(
    (dto: InternalTransferDto) => !dto.recipientId && !dto.recipientEmail,
  )
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/)
  recipientPhone?: string;

  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount must be a positive decimal with at most 2 decimal places',
  })
  amount!: string;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: (typeof SUPPORTED_CURRENCIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/)
  transactionPin?: string;
}

export class RecipientPreviewDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/)
  recipientAccountNumber?: string;

  @ValidateIf(
    (dto: RecipientPreviewDto) => !dto.recipientEmail && !dto.recipientPhone,
  )
  @IsOptional()
  @IsString()
  recipientId?: string;

  @ValidateIf(
    (dto: RecipientPreviewDto) => !dto.recipientId && !dto.recipientPhone,
  )
  @IsOptional()
  @IsEmail()
  @IsString()
  recipientEmail?: string;

  @ValidateIf(
    (dto: RecipientPreviewDto) => !dto.recipientId && !dto.recipientEmail,
  )
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/)
  recipientPhone?: string;
}
