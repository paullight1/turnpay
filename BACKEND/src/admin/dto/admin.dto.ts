import {
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  IsBoolean,
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
}

export class AdminStatsDto {
  totalUsers: number;
  totalTransactions: number;
  totalVolume: number;
  totalFees: number;
  activeUsers: number;
}
