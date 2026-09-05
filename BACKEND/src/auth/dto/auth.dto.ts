import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;
const SIX_DIGIT_OTP_REGEX = /^\d{6}$/;

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class RegisterDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @MaxLength(120)
  fullName?: string;

  @Transform(({ value }) => normalizeEmail(value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(16)
  @Matches(E164_PHONE_REGEX, {
    message: 'Phone number must be a valid E.164 phone number',
  })
  phone: string;

  @IsString()
  @Transform(({ value }) => trimString(value))
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and number',
  })
  password: string;

  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'Transaction PIN must be 4 to 6 digits',
  })
  transactionPin: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  deviceName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'Referral code must contain letters and numbers only',
  })
  referralCode?: string;
}

export class LoginDto {
  @Transform(({ value }) => normalizeEmail(value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Transform(({ value }) => trimString(value))
  password: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @MaxLength(120)
  deviceName?: string;
}

export class ChangePasswordDto {
  @IsString()
  @Transform(({ value }) => trimString(value))
  currentPassword: string;

  @IsString()
  @Transform(({ value }) => trimString(value))
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and number',
  })
  newPassword: string;
}

export class RefreshTokenDto {
  @IsString()
  @Transform(({ value }) => trimString(value))
  refreshToken: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @MaxLength(120)
  deviceName?: string;
}

export class LogoutDto {
  @IsString()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  refreshToken?: string;
}

export class EmailDto {
  @Transform(({ value }) => normalizeEmail(value))
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class PhoneDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(16)
  @Matches(E164_PHONE_REGEX, {
    message: 'Phone number must be a valid E.164 phone number',
  })
  phone: string;
}

export class VerifyOtpDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(16)
  @Matches(E164_PHONE_REGEX, {
    message: 'Phone number must be a valid E.164 phone number',
  })
  phone: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(SIX_DIGIT_OTP_REGEX, {
    message: 'OTP must be exactly 6 digits',
  })
  otp: string;
}

export class SetTransactionPinDto {
  @IsString()
  @Transform(({ value }) => trimString(value))
  @Matches(/^\d{4,6}$/, {
    message: 'Transaction PIN must be 4 to 6 digits',
  })
  pin: string;
}

export class ResetTransactionPinDto {
  @IsString()
  @Transform(({ value }) => trimString(value))
  @Matches(/^\d{4,6}$/, {
    message: 'Transaction PIN must be 4 to 6 digits',
  })
  newPin: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(/^\d{4,6}$/, {
    message: 'Current transaction PIN must be 4 to 6 digits',
  })
  currentPin?: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @Matches(SIX_DIGIT_OTP_REGEX, {
    message: 'OTP must be 6 digits',
  })
  otp?: string;
}

export class StaffRegisterDto {
  @Transform(({ value }) => normalizeEmail(value))
  @IsEmail()
  @MaxLength(254)
  @Matches(/^[^@\s]+@trustpayhq\.com$/, {
    message: 'Staff signup requires a trustpayhq.com email address',
  })
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and number',
  })
  password: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimString(value))
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;
}
