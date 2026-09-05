import { IsIn, IsString, Matches } from 'class-validator';

export class ResolvePaymentAttemptDto {
  @IsIn(['INTERNAL_TRANSFER', 'WITHDRAWAL', 'VTU_PURCHASE'])
  operation: 'INTERNAL_TRANSFER' | 'WITHDRAWAL' | 'VTU_PURCHASE';

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,128}$/)
  attemptKey: string;
}

export class PaymentAttemptResolutionDto {
  state: 'UNKNOWN' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
  reference?: string;
}
