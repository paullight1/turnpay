import { KoraModule } from '../kora/kora.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaystackModule } from '../paystack/paystack.module';
import { PaystackVirtualAccountProvider } from './providers/paystack-virtual-account.provider';
import { Module } from '@nestjs/common';
import { MonnifyKycSyncService } from './monnify-kyc-sync.service';
import { HttpModule } from '@nestjs/axios';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';
import { BeneficiariesService } from './beneficiaries.service';
import { MonnifyVirtualAccountProvider } from './providers/monnify-virtual-account.provider';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    NotificationsModule,
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5,
    }),
    WalletsModule,
    KoraModule,
    PaystackModule,
  ],
  controllers: [BankingController],
  providers: [
    MonnifyKycSyncService,
    BankingService,
    BeneficiariesService,
    MonnifyVirtualAccountProvider,
    PaystackVirtualAccountProvider,
  ],
  exports: [
    BankingService,
    BeneficiariesService,
    MonnifyVirtualAccountProvider,
    PaystackVirtualAccountProvider,
  ],
})
export class BankingModule {}
