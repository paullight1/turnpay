import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OtpService } from './otp.service';
import { SMS_PROVIDER } from './sms-provider';
import { TwilioSmsProvider } from './twilio.provider';

@Module({
  imports: [HttpModule],
  providers: [
    TwilioSmsProvider,
    {
      provide: SMS_PROVIDER,
      useExisting: TwilioSmsProvider,
    },
    OtpService,
  ],
  exports: [OtpService],
})
export class OtpModule {}
