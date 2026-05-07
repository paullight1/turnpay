import { IsString, IsNumber, IsIn, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;
const MAX_AMOUNT = 10_000_000;

export class GetRateDto {
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  from: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  to: (typeof SUPPORTED_CURRENCIES)[number];
}

export class CreateQuoteDto {
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  from: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  to: (typeof SUPPORTED_CURRENCIES)[number];

  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;
}

export class ExecuteQuoteDto {
  @IsString()
  quoteId: string;
}

export class AdminUpdateRateDto {
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  from: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  to: (typeof SUPPORTED_CURRENCIES)[number];

  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  rate: number;

  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  markup: number;
}
