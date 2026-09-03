import { Module } from '@nestjs/common';
import { AuthenticatedUserThrottlerGuard } from '../common/guards/authenticated-user-throttler.guard';
import { WalletsModule } from '../wallets/wallets.module';
import { InternalTransfersAvailabilityGuard } from './guards/internal-transfers-availability.guard';
import { InternalTransferIdempotencyService } from './internal-transfer-idempotency.service';
import { InternalTransferLimitService } from './internal-transfer-limit.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { InternalTransferReversalController } from './internal-transfer-reversal.controller';
import { InternalTransferReversalService } from './internal-transfer-reversal.service';
import { TransferPostCommitHook } from './transfer-post-commit.hook';

@Module({
  imports: [WalletsModule],
  controllers: [TransfersController, InternalTransferReversalController],
  providers: [
    TransfersService,
    InternalTransferIdempotencyService,
    InternalTransferLimitService,
    InternalTransferReversalService,
    InternalTransfersAvailabilityGuard,
    AuthenticatedUserThrottlerGuard,
    TransferPostCommitHook,
  ],
  exports: [TransfersService, InternalTransferLimitService],
})
export class TransfersModule {}
