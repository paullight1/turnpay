import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class MonnifyDestinationAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankName?: string;
}

class MonnifyProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;
}

class MonnifyWebhookEventDataDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  transactionReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  transactionStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountPaid?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalPayable?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  settlementAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentStatus?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MonnifyDestinationAccountDto)
  destinationAccountInformation?: MonnifyDestinationAccountDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MonnifyProductDto)
  product?: MonnifyProductDto;
}

export class MonnifyWebhookDto {
  @IsString()
  @MaxLength(64)
  eventType!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MonnifyWebhookEventDataDto)
  eventData!: MonnifyWebhookEventDataDto;
}

export class PaymentWebhookInboxDto {
  @IsString()
  @MaxLength(32)
  provider!: 'MONNIFY' | 'PAYSTACK';

  @IsString()
  @MaxLength(128)
  eventType!: string;

  @IsString()
  @MaxLength(128)
  providerReference!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

export class PaystackWebhookDto {
  @IsString()
  @MaxLength(128)
  event!: string;

  @IsDefined()
  @IsObject()
  data!: Record<string, unknown>;
}
