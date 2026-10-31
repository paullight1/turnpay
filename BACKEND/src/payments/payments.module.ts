import { ProviderExchangeModule } from '../exchange/provider-exchange.module';
import { KoraModule } from '../kora/kora.module';
import { KoraWebhookController } from '../kora/kora-webhook.controller';
import { PaystackModule } from '../paystack/paystack.module';
import { KycModule } from '../kyc/kyc.module';
import { PaystackFundingService } from './paystack-funding.service';
import { PaystackReadinessController } from './paystack-readiness.controller';
import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { WithdrawalReconcileService } from './withdrawal-reconcile.service';
import { PaymentController } from './payment.controller';
import { WebhookController } from './webhooks/payment-webhook.controller';
import { PaymentWebhookProcessorService } from './webhooks/payment-webhook.processor';
import { WalletsModule } from '../wallets/wallets.module';
import { BankingModule } from '../banking/banking.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { ReconciliationModule } from '../common/services/reconciliation.module';
import { WebhookInboxService } from './webhooks/webhook-inbox.service';

@Module({
  imports: [
    ProviderExchangeModule,
    KoraModule,
    PaystackModule,
    KycModule,
    WalletsModule,
    BankingModule,
    ExchangeModule,
    ReconciliationModule,
  ],
  controllers: [
    KoraWebhookController,
    PaymentController,
    WebhookController,
    PaystackReadinessController,
  ],
  providers: [
    PaymentService,
    PaystackFundingService,
    WithdrawalReconcileService,
    WebhookInboxService,
    PaymentWebhookProcessorService,
  ],
  exports: [
    PaymentService,
    PaystackFundingService,
    WebhookInboxService,
    PaymentWebhookProcessorService,
  ],
})
export class PaymentsModule {}
