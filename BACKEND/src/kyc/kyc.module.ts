import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminKycController,
  KycController,
  KycWebhookController,
} from './kyc.controller';
import { KycService } from './kyc.service';
import { ManualKycProvider } from './providers/manual-kyc.provider';
import { KYC_PROVIDER_GATEWAY } from './providers/kyc-provider.gateway';
import { SmileIdProvider } from './providers/smile-id.provider';

@Module({
  controllers: [KycController, KycWebhookController, AdminKycController],
  providers: [
    KycService,
    ManualKycProvider,
    SmileIdProvider,
    {
      provide: KYC_PROVIDER_GATEWAY,
      inject: [ConfigService, ManualKycProvider, SmileIdProvider],
      useFactory: (
        configService: ConfigService,
        manualKycProvider: ManualKycProvider,
        smileIdProvider: SmileIdProvider,
      ) =>
        configService.get<string>('KYC_PROVIDER') === 'smile_id'
          ? smileIdProvider
          : manualKycProvider,
    },
  ],
})
export class KycModule {}
