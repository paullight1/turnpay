import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VtuService } from './vtu.service';
import { VtuRequeryService } from './vtu-requery.service';
import { VtuController } from './vtu.controller';
import { VtpassWebhookController } from './vtpass-webhook.controller';
import { VtuApiProvider } from './providers/vtu-api.provider';
import { WalletsModule } from '../wallets/wallets.module';
import { VtuReceiptService } from './vtu-receipt.service';
import { VtuWebhookInboxService } from './vtu-webhook-inbox.service';
import { VtuWebhookProcessorService } from './vtu-webhook-processor.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5,
    }),
    WalletsModule,
  ],
  controllers: [VtuController, VtpassWebhookController],
  providers: [
    VtuService,
    VtuRequeryService,
    VtuApiProvider,
    VtuReceiptService,
    VtuWebhookInboxService,
    VtuWebhookProcessorService,
  ],
  exports: [VtuService],
})
export class VtuModule {}
