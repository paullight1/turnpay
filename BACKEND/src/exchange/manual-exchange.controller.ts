import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  AttachManualProofDto,
  CreateManualExchangeDto,
  ManualExchangeQueryDto,
  ManualExchangeReminderDto,
  ManualQueueQueryDto,
  ManualProofReadDto,
  ManualProofUploadDto,
  ReviewManualExchangeDto,
} from './dto/manual-exchange.dto';
import { ManualExchangeService } from './manual-exchange.service';
import { ManualExchangeReconciliationService } from './manual-exchange-reconciliation.service';
import { createRequestAuditContext } from '../common/services/request-audit-context';
import type { AuthenticatedRequest } from '../common/types/request-context';
import {
  RECEIPT_SCAN_MAX_BYTES,
  ReceiptScanService,
} from './receipt-scan.service';

@Controller('exchange/manual-orders')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class ManualExchangeController {
  constructor(
    private readonly service: ManualExchangeService,
    private readonly receiptScanner: ReceiptScanService,
  ) {}
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
  @Get('recovery/created')
  @Header('Cache-Control', 'no-store')
  recoverCreated(
    @CurrentUser() user: { userId: string },
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.recoverCreated(user.userId, key);
  }
  @Get(':id') get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.service.get(id, user.userId);
  }
  @Post(':id/remind')
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  remind(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ManualExchangeReminderDto,
    @Headers('idempotency-key') key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.remind(
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
  @Post(':id/receipt-scan')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: RECEIPT_SCAN_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  async scanReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
    @UploadedFile() image: { buffer: Buffer } | undefined,
  ) {
    if (!image) throw new BadRequestException('Upload a receipt image');
    await this.service.get(id, user.userId);
    return this.receiptScanner.scan(image.buffer);
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
