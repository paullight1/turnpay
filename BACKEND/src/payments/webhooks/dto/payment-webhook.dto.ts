import { Type } from 'class-transformer';
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class PaystackAuthorizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  receiver_bank_account_number?: string;
}

class PaystackWebhookDataDto {
  @IsString()
  @MaxLength(128)
  reference!: string;

  @IsString()
  @MaxLength(64)
  status!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @MaxLength(8)
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  gateway_response?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaystackAuthorizationDto)
  authorization?: PaystackAuthorizationDto;
}

export class PaystackWebhookDto {
  @IsString()
  @MaxLength(64)
  event!: string;

  @ValidateNested()
  @Type(() => PaystackWebhookDataDto)
  data!: PaystackWebhookDataDto;
}

class FlutterwaveCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  account_number?: string;
}

class FlutterwaveWebhookDataDto {
  @IsNumber()
  id!: number;

  @IsString()
  @MaxLength(128)
  tx_ref!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  reference?: string;

  @IsString()
  @MaxLength(64)
  status!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @MaxLength(8)
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  account_number?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FlutterwaveCustomerDto)
  customer?: FlutterwaveCustomerDto;
}

export class FlutterwaveWebhookDto {
  @IsString()
  @MaxLength(64)
  event!: string;

  @ValidateNested()
  @Type(() => FlutterwaveWebhookDataDto)
  data!: FlutterwaveWebhookDataDto;
}

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
  @IsNumber()
  @Min(0)
  amountPaid?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalPayable?: number;

  @IsOptional()
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

  @IsOptional()
  @ValidateNested()
  @Type(() => MonnifyWebhookEventDataDto)
  eventData?: MonnifyWebhookEventDataDto;
}

export class PaymentWebhookInboxDto {
  @IsString()
  @MaxLength(32)
  provider!: 'PAYSTACK' | 'FLUTTERWAVE' | 'MONNIFY';

  @IsString()
  @MaxLength(128)
  eventType!: string;

  @IsString()
  @MaxLength(128)
  providerReference!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
