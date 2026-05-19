import {
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  IsBoolean,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole, KYCStatus } from '@prisma/client';

export class AdminUpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsIn(['USER', 'ADMIN'])
  @IsOptional()
  role?: UserRole;

  @IsIn(['PENDING', 'VERIFIED', 'REJECTED'])
  @IsOptional()
  kycStatus?: KYCStatus;

  @IsBoolean()
  @IsOptional()
  isSuspended?: boolean;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class AdminStatsDto {
  totalUsers: number;
  totalTransactions: number;
  totalVolume: number;
  totalFees: number;
  activeUsers: number;
}

export class AdminActionReasonDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class AdminTransferVerificationDto extends AdminActionReasonDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  providerReference?: string;
}
