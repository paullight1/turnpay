import { NinjaProvider } from './providers/ninja.provider';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { BankingModule } from '../banking/banking.module';
import { PaystackModule } from '../paystack/paystack.module';
import { AdminKycController, KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { PaystackKycRecoveryService } from './paystack-kyc-recovery.service';
import { KYC_PROVIDER_GATEWAY } from './providers/kyc-provider.gateway';
import { MonnifyProvider } from './providers/monnify.provider';
import { PaystackProvider } from './providers/paystack.provider';
import { selectKycProvider } from './providers/kyc-provider.selector';

@Module({
  imports: [
    BankingModule,
    PaystackModule,
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 0,
    }),
  ],
  controllers: [KycController, AdminKycController],
  providers: [
    KycService,
    PaystackKycRecoveryService,
    MonnifyProvider,
    PaystackProvider,
    NinjaProvider,
    {
      provide: KYC_PROVIDER_GATEWAY,
      inject: [ConfigService, MonnifyProvider, PaystackProvider],
      useFactory: (
        config: ConfigService,
        monnify: MonnifyProvider,
        paystack: PaystackProvider,
      ) =>
        selectKycProvider(
          config.get<string>('KYC_PROVIDER'),
          monnify,
          paystack,
        ),
    },
  ],
  exports: [KycService],
})
export class KycModule {}
