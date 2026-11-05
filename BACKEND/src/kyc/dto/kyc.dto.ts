import {
  IsString,
  IsIn,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
  IsInt,
  Min,
  Max,
  IsBoolean,
  Equals,
  IsDateString,
} from 'class-validator';
import { KYCType } from '@prisma/client';

const ALLOWED_KYC_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export class ReconcilePaystackKycDto {
  @IsOptional()
  @IsIn(['status'])
  action?: 'status';
}

export class CreateKycUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  @Matches(/^[A-Za-z0-9._ -]+$/, {
    message: 'File name contains unsupported characters',
  })
  fileName: string;

  @IsString()
  @IsIn(ALLOWED_KYC_CONTENT_TYPES)
  contentType: (typeof ALLOWED_KYC_CONTENT_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(8 * 1024 * 1024)
  fileSize: number;
}

export class CreateIdentityVerificationDto {
  @IsOptional()
  @IsBoolean()
  retryPending?: boolean;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z][A-Za-z' -]*$/, {
    message: 'First name contains unsupported characters',
  })
  firstName?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z][A-Za-z' -]*$/, {
    message: 'Last name contains unsupported characters',
  })
  lastName?: string;

  @IsString()
  @IsIn(['BVN', 'NIN'])
  type: KYCType;

  @IsString()
  @IsIn(['NG'])
  country: 'NG';

  @IsString()
  @MinLength(5)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'ID number can contain letters, numbers, and hyphen only',
  })
  idNumber: string;

  @IsDateString({ strict: true, strictSeparator: true })
  dateOfBirth: string;

  @IsBoolean()
  @Equals(true, {
    message: 'Consent is required before starting identity verification',
  })
  consentAccepted: true;

  /** Required for Paystack's Nigerian bank-account identification flow. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankCode?: string;

  /** Optional consent to prepare a dedicated account after validation. */
  @IsOptional()
  @IsBoolean()
  accountSetupConsent?: boolean;
}

export class CreateManualKycDocumentDto {
  @IsString()
  @IsIn(['NIN'])
  type: 'NIN';

  @IsString()
  @Matches(/^\d{11}$/)
  idNumber: string;

  @IsString()
  @MaxLength(255)
  @Matches(/^kyc\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/)
  objectKey: string;

  @IsBoolean()
  @Equals(true, {
    message: 'Consent is required before submitting a manual identity document',
  })
  consentAccepted: true;
}

export class ReviewKycDto {
  @IsString()
  @IsIn(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(500)
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
  @MinLength(10)
  @MaxLength(500)
  description: string;
}

export class ResolveDisputeDto {
  @IsString()
  @IsIn(['RESOLVED', 'CLOSED', 'ESCALATED'])
  status: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  resolution?: string;
}
