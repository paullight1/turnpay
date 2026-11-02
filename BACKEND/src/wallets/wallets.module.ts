import { TierOneLimitsService } from '../common/services/tier-one-limits.service';
import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { LedgerService } from './ledger.service';
import { ReconciliationModule } from '../common/services/reconciliation.module';

@Module({
  imports: [ReconciliationModule],
  controllers: [WalletsController],
  providers: [WalletsService, LedgerService, TierOneLimitsService],
  exports: [WalletsService, LedgerService, TierOneLimitsService],
})
export class WalletsModule {}
