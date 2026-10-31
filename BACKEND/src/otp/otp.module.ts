import { Module } from '@nestjs/common';
import { OtpService } from './otp.service';
import { EmailOtpProvider } from './email-otp.provider';

@Module({ providers: [EmailOtpProvider, OtpService], exports: [OtpService] })
export class OtpModule {}
