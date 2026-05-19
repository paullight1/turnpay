import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { WebhookController } from './webhooks/payment-webhook.controller';
import { PaystackProvider } from './providers/paystack.provider';
import { FlutterwaveProvider } from './providers/flutterwave.provider';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BankingModule } from '../banking/banking.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5,
    }),
    UsersModule,
    WalletsModule,
    BankingModule,
  ],
  controllers: [PaymentController, WebhookController],
  providers: [PaymentService, PaystackProvider, FlutterwaveProvider],
  exports: [PaymentService, PaystackProvider, FlutterwaveProvider],
})
export class PaymentsModule {}
