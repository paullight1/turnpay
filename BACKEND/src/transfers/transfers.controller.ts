import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUserThrottlerGuard } from '../common/guards/authenticated-user-throttler.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedRequest } from '../common/types/request-context';
import { createRequestAuditContext } from '../common/services/request-audit-context';
import {
  InternalTransferDto,
  RecipientPreviewDto,
} from './dto/internal-transfer.dto';
import { InternalTransfersAvailabilityGuard } from './guards/internal-transfers-availability.guard';
import { TransfersService } from './transfers.service';

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post('internal')
  @UseGuards(
    InternalTransfersAvailabilityGuard,
    AuthenticatedUserThrottlerGuard,
  )
  @Throttle({ verifiedUser: { limit: 5, ttl: 60000 } })
  sendInternalTransfer(
    @CurrentUser() user: { userId: string },
    @Body() dto: InternalTransferDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const auditContext = createRequestAuditContext(request, {
      actorId: user.userId,
      idempotencyKey,
    });

    return this.transfersService.sendInternalTransfer(user.userId, dto, {
      idempotencyKey,
      requestId: auditContext.requestId,
      ipAddress: auditContext.ipAddress,
      ...(auditContext.userAgent && { userAgent: auditContext.userAgent }),
    });
  }

  @Post('recipient/preview')
  @UseGuards(AuthenticatedUserThrottlerGuard)
  @Throttle({
    default: { limit: 10, ttl: 60000 },
    verifiedUser: { limit: 10, ttl: 60000 },
  })
  @HttpCode(HttpStatus.OK)
  previewRecipient(
    @CurrentUser() user: { userId: string },
    @Body() dto: RecipientPreviewDto,
  ) {
    return this.transfersService.previewRecipient(user.userId, dto);
  }

  @Get('internal/:reference')
  getInternalTransfer(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
  ) {
    return this.transfersService.getInternalTransferByReference(
      user.userId,
      reference,
    );
  }
}
