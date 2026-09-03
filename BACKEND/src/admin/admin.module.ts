import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { WalletsModule } from '../wallets/wallets.module';
import { PaymentsModule } from '../payments/payments.module';
import { VtuModule } from '../vtu/vtu.module';
import { BankingModule } from '../banking/banking.module';
import { ReconciliationModule } from '../common/services/reconciliation.module';

@Module({
  imports: [
    WalletsModule,
    PaymentsModule,
    VtuModule,
    BankingModule,
    ReconciliationModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
