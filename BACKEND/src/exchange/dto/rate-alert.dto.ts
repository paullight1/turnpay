import { Type } from 'class-transformer';
import { IsString, IsNumber, IsIn, IsPositive } from 'class-validator';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;

export class CreateRateAlertDto {
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  fromCurrency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  toCurrency: (typeof SUPPORTED_CURRENCIES)[number];

  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  targetRate: number;

  @IsString()
  @IsIn(['ABOVE', 'BELOW'])
  direction: 'ABOVE' | 'BELOW';
}
