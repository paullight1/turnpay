import {
  Equals,
  IsObject,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
export class KoraAccountRequestDto {
  @IsBoolean() @Equals(true) consentAccepted!: true;
}
export class KoraMomoIntentDto {
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,8}(\.\d{1,2})?$/) amount?: string;
  @IsString() @Matches(/^233\d{9}$/) mobileNumber!: string;
}
export class KoraOtpDto {
  @IsString() @Matches(/^\d{4,8}$/) otp!: string;
}
export class KoraWebhookDto {
  @IsString() @MaxLength(80) @Matches(/^[a-z_]+\.[a-z_]+$/) event!: string;
  @IsObject() data!: Record<string, unknown>;
}
export class KoraReleaseDto {
  @IsString() @MinLength(10) @MaxLength(500) reason!: string;
  @IsOptional() @IsBoolean() honorExpiredQuote?: boolean;
}
export class GhsWithdrawDto {
  @IsOptional() @IsString() @MaxLength(120) expectedName?: string;
  @IsString() @Matches(/^\d{1,8}(\.\d{1,2})?$/) amount!: string;
  @IsString() @Matches(/^233\d{9}$/) mobileNumber!: string;
  @IsString() @Matches(/^[a-z0-9-]{2,32}$/) operator!: string;
  @IsString() @Matches(/^\d{4,6}$/) transactionPin!: string;
}

export class KoraRecipientDto {
  @IsString() @Matches(/^233\d{9}$/) mobileNumber!: string;
  @IsString() @Matches(/^[a-z0-9-]{2,32}$/) operator!: string;
}
