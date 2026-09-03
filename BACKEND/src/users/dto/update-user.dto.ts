import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  fullName?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\+\d{12,14}$/, {
    message: 'Phone number must use international format',
  })
  phone?: string;

  @IsInt()
  @IsOptional()
  @Min(1900)
  @Max(new Date().getFullYear() - 13)
  yearOfBirth?: number;

  @IsString()
  @IsOptional()
  @IsIn(['NG', 'GH'], {
    message: 'Country must be NG or GH',
  })
  country?: string;
}
