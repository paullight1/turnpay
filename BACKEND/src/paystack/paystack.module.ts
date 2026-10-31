import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaystackClient } from './paystack.client';

@Module({
  imports: [HttpModule.register({ timeout: 15000, maxRedirects: 0 })],
  providers: [PaystackClient],
  exports: [PaystackClient],
})
export class PaystackModule {}
