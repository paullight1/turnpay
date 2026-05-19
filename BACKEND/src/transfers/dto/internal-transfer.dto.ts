import {
  IsIn,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;
const MAX_AMOUNT = 10_000_000;

export class InternalTransferDto {
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

  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Max(MAX_AMOUNT)
  amount: number;

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}
