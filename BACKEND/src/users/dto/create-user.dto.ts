import {
  IsEmail,
  IsString,
  MinLength,
  Matches,
  IsOptional,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateUserDto {
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  fullName?: string;

  @IsString()
  @Matches(/^(\+?\d{10,15})$/, {
    message: 'Phone number must be a valid format',
  })
  @IsOptional()
  phone?: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and number',
  })
  @IsOptional()
  password?: string;
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  fullName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
