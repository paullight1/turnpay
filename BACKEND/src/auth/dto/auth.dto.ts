import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  fullName?: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^(\+?\d{10,15})$/, {
    message: 'Phone number must be a valid format',
  })
  phone: string;

  @IsString()
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
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  deviceName?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and number',
  })
  newPassword: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  deviceName?: string;
}

export class LogoutDto {
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class EmailDto {
  @IsEmail()
  email: string;
}

export class PhoneDto {
  @IsString()
  @Matches(/^(\+?\d{10,15})$/, {
    message: 'Phone number must be a valid format',
  })
  phone: string;
}

export class VerifyOtpDto {
  @IsString()
  phone: string;

  @IsString()
  otp: string;
}

export class SetTransactionPinDto {
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'Transaction PIN must be 4 to 6 digits',
  })
  pin: string;
}

export class ResetTransactionPinDto {
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'Transaction PIN must be 4 to 6 digits',
  })
  newPin: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4,6}$/, {
    message: 'Current transaction PIN must be 4 to 6 digits',
  })
  currentPin?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{6}$/, {
    message: 'OTP must be 6 digits',
  })
  otp?: string;
}
