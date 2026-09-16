import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from '../guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ReconciliationService } from './reconciliation.service';
import { ClearReconciliationHoldDto } from './reconciliation-hold.dto';

/**
 * Explicit operator release for a persisted reconciliation hold. Keeping the
 * route beside the hold service makes it impossible to accidentally release a
 * BLOCKED run by simply starting another reconciliation.
 */
@Controller('admin/reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ReconciliationHoldController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('runs/:blockedRunId/clear')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  clearHold(
    @CurrentUser() user: { userId: string },
    @Param('blockedRunId', ParseUUIDPipe) blockedRunId: string,
    @Body() dto: ClearReconciliationHoldDto,
  ) {
    return this.reconciliation.clearHoldAfterPassingRun(
      blockedRunId,
      dto.passingRunId,
      user.userId,
      dto.reason,
    );
  }
}
