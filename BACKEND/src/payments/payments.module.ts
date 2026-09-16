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
  imports: [WalletsModule, BankingModule, ExchangeModule, ReconciliationModule],
  controllers: [PaymentController, WebhookController],
  providers: [
    PaymentService,
    WithdrawalReconcileService,
    WebhookInboxService,
    PaymentWebhookProcessorService,
  ],
  exports: [
    PaymentService,
    WebhookInboxService,
    PaymentWebhookProcessorService,
  ],
})
export class PaymentsModule {}
