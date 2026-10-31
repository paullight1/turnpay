import { KoraReadinessController } from './kora-readiness.controller';
import { TransactionPinModule } from '../common/services/transaction-pin.module';
import { CircuitBreakerModule } from '../common/services/circuit-breaker.module';
import { GhsWithdrawalsService } from './ghs-withdrawals.service';
import { KoraPayoutsService } from './kora-payouts.service';
import { ReconciliationModule } from '../common/services/reconciliation.module';
import { WalletsModule } from '../wallets/wallets.module';
import { KoraCollectionsService } from './kora-collections.service';
import { KoraController } from './kora.controller';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { KoraCapabilitiesService } from './kora-capabilities.service';
import { KoraClient } from './kora.client';
import { KoraAccountsService } from './kora-accounts.service';
@Module({
  imports: [
    TransactionPinModule,
    CircuitBreakerModule,
    ReconciliationModule,
    WalletsModule,
    HttpModule.register({ timeout: 15000, maxRedirects: 0 }),
  ],
  controllers: [KoraController, KoraReadinessController],
  providers: [
    GhsWithdrawalsService,
    KoraPayoutsService,
    KoraCollectionsService,
    KoraCapabilitiesService,
    KoraClient,
    KoraAccountsService,
  ],
  exports: [
    GhsWithdrawalsService,
    KoraPayoutsService,
    KoraCollectionsService,
    KoraCapabilitiesService,
    KoraClient,
    KoraAccountsService,
  ],
})
export class KoraModule {}
