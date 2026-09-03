import { Global, Module } from '@nestjs/common';
import { TransactionPinService } from './transaction-pin.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [TransactionPinService],
  exports: [TransactionPinService],
})
export class TransactionPinModule {}
