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
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5,
    }),
    WalletsModule,
  ],
  controllers: [BankingController],
  providers: [
    MonnifyKycSyncService,
    BankingService,
    BeneficiariesService,
    MonnifyVirtualAccountProvider,
  ],
  exports: [
    BankingService,
    BeneficiariesService,
    MonnifyVirtualAccountProvider,
  ],
})
export class BankingModule {}
