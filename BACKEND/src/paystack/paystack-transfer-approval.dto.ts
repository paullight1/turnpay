import { Equals, IsInt, IsString, Matches, Max, Min } from 'class-validator';

/** Paystack posts the original initiation payload, in currency subunits. */
export class PaystackTransferApprovalDto {
  @IsString()
  @Matches(/^[a-z0-9_-]{16,50}$/)
  reference!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount!: number;

  @Equals('NGN')
  currency!: string;

  @Equals('balance')
  source!: string;

  @IsString()
  @Matches(/^RCP_[a-zA-Z0-9_]{1,100}$/)
  recipient!: string;
}
