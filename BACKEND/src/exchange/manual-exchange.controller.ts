import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  AttachManualProofDto,
  CreateManualExchangeDto,
  ManualExchangeQueryDto,
  ManualQueueQueryDto,
  ManualProofReadDto,
  ManualProofUploadDto,
  ReviewManualExchangeDto,
} from './dto/manual-exchange.dto';
import { ManualExchangeService } from './manual-exchange.service';
import { ManualExchangeReconciliationService } from './manual-exchange-reconciliation.service';
import { createRequestAuditContext } from '../common/services/request-audit-context';
import type { AuthenticatedRequest } from '../common/types/request-context';

@Controller('exchange/manual-orders')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class ManualExchangeController {
  constructor(private readonly service: ManualExchangeService) {}
  @Get('config') configuration() {
    return this.service.configuration();
  }
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateManualExchangeDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(
      user.userId,
      dto,
      key,
      createRequestAuditContext(request, {
        actorId: user.userId,
        idempotencyKey: key,
      }),
    );
  }
  @Get() list(@CurrentUser() user: { userId: string }) {
    return this.service.list(user.userId);
  }
  @Get(':id') get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.service.get(id, user.userId);
  }
  @Post(':id/upload-url')
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ManualProofUploadDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.uploadUrl(id, user.userId, dto, key);
  }
  @Post(':id/proof') attach(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: AttachManualProofDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.attach(id, user.userId, dto, key);
  }
  @Get(':id/proof-url') proof(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.service.proofUrl(id, user.userId);
  }
}

@Controller('admin/exchange/manual-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class AdminManualExchangeController {
  constructor(
    private readonly service: ManualExchangeService,
    private readonly reconciliation: ManualExchangeReconciliationService,
  ) {}
  @Get('reconciliation') reconciliationRuns() {
    return this.reconciliation.latest();
  }
  @Get('queue') queue(@Query() query: ManualQueueQueryDto) {
    return this.service.queue(query);
  }
  @Get() list(@Query() query: ManualExchangeQueryDto) {
    return this.service.list(undefined, query.status);
  }
  @Post(':id/review')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReviewManualExchangeDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.review(
      id,
      user.userId,
      dto,
      key,
      createRequestAuditContext(request, {
        actorId: user.userId,
        idempotencyKey: key,
      }),
    );
  }
  @Post(':id/upload-url')
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ManualProofUploadDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.uploadUrl(id, user.userId, dto, key, true);
  }
  @Post(':id/handover-upload-url')
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  uploadHandoverEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ManualProofUploadDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.uploadHandoverUrl(id, user.userId, dto, key);
  }
  @Post(':id/proof-url') proof(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ManualProofReadDto,
  ) {
    return this.service.proofUrl(id, user.userId, true, dto.kind);
  }
}
