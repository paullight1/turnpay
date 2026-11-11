import { NotificationsModule } from '../notifications/notifications.module';
import {
  ManualExchangeController,
  AdminManualExchangeController,
} from './manual-exchange.controller';
import { ManualExchangeService } from './manual-exchange.service';
import { ManualExchangeReconciliationService } from './manual-exchange-reconciliation.service';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExchangeService } from './exchange.service';
import {
  AdminExchangeController,
  ExchangeController,
} from './exchange.controller';
import { RateService } from './providers/rate.service';
import {
  RateAlertService,
  NotificationService,
} from './providers/rate-alert.service';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BankingModule } from '../banking/banking.module';
import { ReconciliationModule } from '../common/services/reconciliation.module';
import { ReceiptScanService } from './receipt-scan.service';

@Module({
  imports: [
    NotificationsModule,
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    UsersModule,
    WalletsModule,
    BankingModule,
    ReconciliationModule,
  ],
  controllers: [
    ExchangeController,
    AdminExchangeController,
    ManualExchangeController,
    AdminManualExchangeController,
  ],
  providers: [
    ExchangeService,
    ManualExchangeService,
    ReceiptScanService,
    ManualExchangeReconciliationService,
    RateService,
    RateAlertService,
    NotificationService,
  ],
  exports: [ExchangeService, RateService],
})
export class ExchangeModule {}
