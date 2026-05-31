import { IsEmail, IsString, IsOptional, MaxLength } from "class-validator";

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
