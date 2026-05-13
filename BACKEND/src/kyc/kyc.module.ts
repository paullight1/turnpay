import { Module } from '@nestjs/common';
import { KycController, AdminKycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  controllers: [KycController, AdminKycController],
  providers: [KycService],
})
export class KycModule {}
