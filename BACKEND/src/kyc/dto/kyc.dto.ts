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
} from "class-validator";
import { KYCType } from "@prisma/client";

const ALLOWED_KYC_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export class CreateKycUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  @Matches(/^[A-Za-z0-9._ -]+$/, {
    message: "File name contains unsupported characters",
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

export class SubmitKycDto {
  @IsString()
  @IsIn(["BVN", "NIN", "PASSPORT", "DRIVERS_LICENSE", "VOTERS_CARD"])
  type: KYCType;

  @IsString()
  @MaxLength(300)
  @Matches(/^kyc\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/, {
    message: "Document object key is invalid",
  })
  documentObjectKey: string;

  @IsString()
  @MinLength(5)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: "ID number can contain letters, numbers, and hyphen only",
  })
  idNumber: string;
}

export class ReviewKycDto {
  @IsString()
  @IsIn(["VERIFIED", "REJECTED"])
  status: "VERIFIED" | "REJECTED";

  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(500)
  rejectionNote?: string;
}

export class CreateDisputeDto {
  @IsString()
  @IsIn(["TRANSACTION", "WITHDRAWAL", "EXCHANGE", "VTU", "OTHER"])
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
  @IsIn(["RESOLVED", "CLOSED", "ESCALATED"])
  status: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  resolution?: string;
}
