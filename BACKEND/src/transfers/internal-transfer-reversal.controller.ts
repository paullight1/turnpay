import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../common/types/request-context';
import { createRequestAuditContext } from '../common/services/request-audit-context';
import {
  InternalTransferReferenceParamDto,
  InternalTransferReversalIdParamDto,
  InternalTransferReversalReasonDto,
} from './dto/internal-transfer-reversal.dto';
import { InternalTransferReversalService } from './internal-transfer-reversal.service';

@Controller('admin/transfers/internal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class InternalTransferReversalController {
  constructor(private readonly reversals: InternalTransferReversalService) {}

  @Get('reversals')
  listReversals() {
    return this.reversals.listReversals();
  }

  @Get('reversals/:id')
  getReversal(@Param() params: InternalTransferReversalIdParamDto) {
    return this.reversals.getReversal(params.id);
  }

  @Post(':reference/reversals')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  requestReversal(
    @CurrentUser() user: { userId: string },
    @Param() params: InternalTransferReferenceParamDto,
    @Body() dto: InternalTransferReversalReasonDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const auditContext = createRequestAuditContext(request, {
      actorId: user.userId,
      idempotencyKey,
    });
    return this.reversals.requestReversal(params.reference, dto, user.userId, {
      idempotencyKey,
      requestId: auditContext.requestId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });
  }

  @Post('reversals/:id/approve')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  approveReversal(
    @CurrentUser() user: { userId: string },
    @Param() params: InternalTransferReversalIdParamDto,
    @Body() dto: InternalTransferReversalReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reversals.approveReversal(
      params.id,
      dto,
      user.userId,
      createRequestAuditContext(request, { actorId: user.userId }),
    );
  }

  @Post('reversals/:id/reject')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  rejectReversal(
    @CurrentUser() user: { userId: string },
    @Param() params: InternalTransferReversalIdParamDto,
    @Body() dto: InternalTransferReversalReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reversals.rejectReversal(
      params.id,
      dto,
      user.userId,
      createRequestAuditContext(request, { actorId: user.userId }),
    );
  }
}
