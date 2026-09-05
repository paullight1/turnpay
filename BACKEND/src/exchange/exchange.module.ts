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

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    UsersModule,
    WalletsModule,
    BankingModule,
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
    ManualExchangeReconciliationService,
    RateService,
    RateAlertService,
    NotificationService,
  ],
  exports: [ExchangeService, RateService],
})
export class ExchangeModule {}
