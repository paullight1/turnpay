import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { LedgerService } from './ledger.service';
import { ReconciliationModule } from '../common/services/reconciliation.module';

@Module({
  imports: [ReconciliationModule],
  controllers: [WalletsController],
  providers: [WalletsService, LedgerService],
  exports: [WalletsService, LedgerService],
})
export class WalletsModule {}
