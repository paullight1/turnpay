import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsIn,
  IsPositive,
  Matches,
  IsOptional,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  LimitQueryDto,
  MONEY_AMOUNT_PATTERN,
  normalizeDecimalInput,
} from '../../common/dto/query.dto';

const EXCHANGE_PAYOUT_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'PROCESSING',
  'SENT',
  'FAILED',
  'REVERSED',
] as const;

const SUPPORTED_CURRENCIES = ['NGN', 'GHS'] as const;
const EXCHANGE_RECEIPT_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'CREDITED',
  'REJECTED',
  'NEEDS_MORE_INFO',
] as const;
const ALLOWED_RECEIPT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

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

  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount must be a positive decimal with at most 2 decimal places',
  })
  amount: string;
}

export class ExecuteQuoteDto {
  @IsString()
  quoteId: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/)
  transactionPin?: string;
}

export class AdminUpdateRateDto {
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  from: (typeof SUPPORTED_CURRENCIES)[number];

  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  to: (typeof SUPPORTED_CURRENCIES)[number];

  // Absolute ceiling; the service also validates the Ghana pair's direction.
  // Rates always mean target units received per 1 source unit.
  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  @Max(100_000)
  rate: number;

  // Markup remains supported for older clients, but the admin UI now writes
  // the customer-facing rate directly with a zero markup.
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(50)
  markup?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminApproveRateOverrideDto {
  @IsString()
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class SubmitExchangeReceiptDto {
  @Transform(({ value }: { value: unknown }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount must be a positive decimal with at most 2 decimal places',
  })
  amount: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._-]{4,80}$/)
  bankReference: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  senderName: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  senderBankName?: string;

  @ValidateIf((dto: SubmitExchangeReceiptDto) => !dto.receiptObjectKey)
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(500)
  receiptUrl?: string;

  @ValidateIf((dto: SubmitExchangeReceiptDto) => !dto.receiptUrl)
  @IsString()
  @MaxLength(300)
  @Matches(/^exchange-receipts\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/, {
    message: 'Receipt object key is invalid',
  })
  receiptObjectKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateMonnifyExchangeDepositDto {
  @Transform(({ value }: { value: unknown }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message: 'amount must be a positive decimal with at most 2 decimal places',
  })
  amount: string;
}

export class CreateExchangeReceiptUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  @Matches(/^[A-Za-z0-9._ -]+$/, {
    message: 'File name contains unsupported characters',
  })
  fileName: string;

  @IsString()
  @IsIn(ALLOWED_RECEIPT_CONTENT_TYPES)
  contentType: (typeof ALLOWED_RECEIPT_CONTENT_TYPES)[number];

  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  fileSize: number;
}

export class AdminExchangeReceiptsQueryDto extends LimitQueryDto {
  @IsIn(EXCHANGE_RECEIPT_STATUSES)
  @IsOptional()
  status?: (typeof EXCHANGE_RECEIPT_STATUSES)[number];
}

export class AdminReviewExchangeReceiptDto {
  @IsString()
  @IsIn(['APPROVED', 'REJECTED', 'NEEDS_MORE_INFO'])
  status: 'APPROVED' | 'REJECTED' | 'NEEDS_MORE_INFO';

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class CreateExchangePayoutDto {
  @Transform(({ value }) => normalizeDecimalInput(value))
  @IsString()
  @Matches(MONEY_AMOUNT_PATTERN, {
    message:
      'sourceAmount must be a positive decimal with at most 2 decimal places',
  })
  sourceAmount: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  destinationBankName: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  destinationBankCode?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(20)
  @Matches(/^\d{10,20}$/, {
    message: 'destinationAccountNumber must be 10-20 digits',
  })
  destinationAccountNumber: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  destinationAccountName: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'transactionPin must be 4-6 digits',
  })
  transactionPin?: string;
}

export class AdminExchangePayoutsQueryDto extends LimitQueryDto {
  @IsIn(EXCHANGE_PAYOUT_STATUSES)
  @IsOptional()
  status?: (typeof EXCHANGE_PAYOUT_STATUSES)[number];
}

export class AdminReviewPayoutDto {
  @IsString()
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class AdminMarkPayoutSentDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(500)
  paymentReceiptUrl?: string;
}
