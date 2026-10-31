import { ProviderNotificationsService } from './provider-notifications.service';
import { Module } from '@nestjs/common';
import { ProviderExchangeService } from './provider-exchange.service';
import { ProviderExchangeSettlementService } from './provider-exchange-settlement.service';
import {
  ProviderExchangeController,
  AdminProviderExchangeController,
} from './provider-exchange.controller';
import { ExchangeModule } from './exchange.module';
import { KoraModule } from '../kora/kora.module';
import { PaystackModule } from '../paystack/paystack.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ReconciliationModule } from '../common/services/reconciliation.module';
@Module({
  imports: [
    ExchangeModule,
    KoraModule,
    PaystackModule,
    WalletsModule,
    ReconciliationModule,
  ],
  providers: [
    ProviderExchangeService,
    ProviderExchangeSettlementService,
    ProviderNotificationsService,
  ],
  controllers: [ProviderExchangeController, AdminProviderExchangeController],
  exports: [ProviderExchangeService, ProviderExchangeSettlementService],
})
export class ProviderExchangeModule {}
