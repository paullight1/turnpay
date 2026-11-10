import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
export class ProviderExchangeQuoteDto {
  @IsIn(['GHS', 'NGN']) sourceCurrency!: 'GHS' | 'NGN';
  @IsIn(['WALLET', 'EXTERNAL']) fundingSource!: 'WALLET' | 'EXTERNAL';
  @IsString() @Matches(/^\d{1,8}(\.\d{1,2})?$/) amount!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{2,32}$/) destinationCode!: string;
  @IsString() @Matches(/^\d{10,12}$/) destinationNumber!: string;
}
export class CreateProviderExchangeDto {
  @IsUUID() quoteId!: string;
  @IsString() @Matches(/^\d{4,6}$/) transactionPin!: string;
}

export class ProviderOrdersQueryDto {
  @IsOptional()
  @IsIn([
    'ALL',
    'READY',
    'AWAITING_PAYMENT',
    'PROCESSING',
    'NEEDS_REVIEW',
    'SENT',
    'REFUNDED',
    'FAILED',
  ])
  status?: string;
  @IsOptional() @IsUUID() cursor?: string;
}
