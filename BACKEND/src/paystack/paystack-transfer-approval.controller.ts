import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaystackTransferApprovalService } from './paystack-transfer-approval.service';

@Controller('webhooks/paystack')
export class PaystackTransferApprovalController {
  constructor(private readonly approval: PaystackTransferApprovalService) {}

  // Provider decision endpoint: no customer JWT or merchant OTP. The service
  // requires an exact server-sealed reservation and never settles money here.
  @Post('transfer-approval')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  approve(@Body() body: unknown) {
    return this.approval.approve(body);
  }
}
