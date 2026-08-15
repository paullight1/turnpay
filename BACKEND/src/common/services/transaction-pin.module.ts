import { Global, Module } from '@nestjs/common';
import { TransactionPinService } from './transaction-pin.service';

@Global()
@Module({
  providers: [TransactionPinService],
  exports: [TransactionPinService],
})
export class TransactionPinModule {}
