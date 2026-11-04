import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaystackClient } from './paystack.client';
import { PaystackTransferApprovalService } from './paystack-transfer-approval.service';
import { PaystackTransferApprovalController } from './paystack-transfer-approval.controller';
import { ReconciliationModule } from '../common/services/reconciliation.module';

@Module({
  imports: [
    HttpModule.register({ timeout: 15000, maxRedirects: 0 }),
    ReconciliationModule,
  ],
  controllers: [PaystackTransferApprovalController],
  providers: [PaystackClient, PaystackTransferApprovalService],
  exports: [PaystackClient, PaystackTransferApprovalService],
})
export class PaystackModule {}
