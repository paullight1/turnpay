import { IsString, IsIn, IsOptional } from 'class-validator';
import { KYCType } from '@prisma/client';

export class SubmitKycDto {
  @IsString()
  @IsIn(['BVN', 'NIN', 'PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD'])
  type: KYCType;

  @IsString()
  documentUrl: string;

  @IsString()
  idNumber: string;
}

export class ReviewKycDto {
  @IsString()
  @IsIn(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  @IsString()
  @IsOptional()
  rejectionNote?: string;
}

export class CreateDisputeDto {
  @IsString()
  @IsIn(['TRANSACTION', 'WITHDRAWAL', 'EXCHANGE', 'VTU', 'OTHER'])
  type: string;

  @IsString()
  @IsOptional()
  transactionId?: string;

  @IsString()
  description: string;
}

export class ResolveDisputeDto {
  @IsString()
  @IsIn(['RESOLVED', 'CLOSED', 'ESCALATED'])
  status: string;

  @IsString()
  @IsOptional()
  resolution?: string;
}
