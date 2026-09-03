import { IsString, Matches } from 'class-validator';

export class VerifyTransactionPinDto {
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'Transaction PIN must be 4 to 6 digits',
  })
  pin: string;
}
