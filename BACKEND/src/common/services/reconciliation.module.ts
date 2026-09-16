import { Module } from '@nestjs/common';
import { ReconciliationHoldController } from './reconciliation-hold.controller';
import { ReconciliationService } from './reconciliation.service';
import { SettlementHoldService } from './settlement-hold.service';

@Module({
  controllers: [ReconciliationHoldController],
  providers: [ReconciliationService, SettlementHoldService],
  exports: [ReconciliationService, SettlementHoldService],
})
export class ReconciliationModule {}
