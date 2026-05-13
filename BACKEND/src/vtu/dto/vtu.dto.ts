import {
  IsString,
  IsNumber,
  IsIn,
  IsPositive,
  IsOptional,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

const VTU_TYPES = ['airtime', 'data', 'cable', 'electricity'] as const;
const VTU_PROVIDERS = [
  'mtn',
  'airtel',
  'glo',
  'dstv',
  'gotv',
  'startimes',
  'ikedc',
  'ekedc',
  'aedc',
] as const;
const MAX_AMOUNT = 1_000_000;

export class GetVtuProvidersDto {
  @IsString()
  @IsOptional()
  @IsIn(VTU_TYPES)
  type?: (typeof VTU_TYPES)[number];
}

export class GetVtuPackagesDto {
  @IsString()
  @IsIn(VTU_PROVIDERS)
  provider: (typeof VTU_PROVIDERS)[number];
}

export class PurchaseVtuDto {
  @IsString()
  @IsIn(VTU_TYPES)
  type: (typeof VTU_TYPES)[number];

  @IsString()
  @IsIn(VTU_PROVIDERS)
  provider: (typeof VTU_PROVIDERS)[number];

  @IsString()
  recipientNumber: string;

  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  @Max(MAX_AMOUNT)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsString()
  @IsOptional()
  packageId?: string;

  @IsString()
  @IsOptional()
  smartCardNumber?: string;

  @IsString()
  @IsOptional()
  meterNumber?: string;
}
