import { Module } from '@nestjs/common';
import { PaymentAttemptsController } from './payment-attempts.controller';
import { PaymentAttemptsService } from './payment-attempts.service';

@Module({
  controllers: [PaymentAttemptsController],
  providers: [PaymentAttemptsService],
})
export class PaymentAttemptsModule {}
