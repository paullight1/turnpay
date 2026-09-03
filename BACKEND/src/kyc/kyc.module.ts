import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import {
  AdminKycController,
  KycController,
  KycWebhookController,
} from './kyc.controller';
import { KycService } from './kyc.service';
import { KYC_PROVIDER_GATEWAY } from './providers/kyc-provider.gateway';
import { YouverifyProvider } from './providers/youverify.provider';
import { NinjaProvider } from './providers/ninja.provider';
import { selectKycProvider } from './providers/kyc-provider.selector';
import { KycWebhookInboxService } from './kyc-webhook-inbox.service';
import { KycWebhookProcessorService } from './kyc-webhook-processor.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 0,
    }),
  ],
  controllers: [KycController, KycWebhookController, AdminKycController],
  providers: [
    KycService,
    KycWebhookInboxService,
    KycWebhookProcessorService,
    YouverifyProvider,
    NinjaProvider,
    {
      provide: KYC_PROVIDER_GATEWAY,
      inject: [ConfigService, NinjaProvider, YouverifyProvider],
      useFactory: (
        config: ConfigService,
        ninja: NinjaProvider,
        youverify: YouverifyProvider,
      ) =>
        selectKycProvider(config.get<string>('KYC_PROVIDER'), ninja, youverify),
    },
  ],
})
export class KycModule {}
