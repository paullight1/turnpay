import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Query,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ExchangeService } from './exchange.service';
import { RateService } from './providers/rate.service';
import { RateAlertService } from './providers/rate-alert.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateQuoteDto,
  ExecuteQuoteDto,
  AdminUpdateRateDto,
  AdminApproveRateOverrideDto,
  GetRateDto,
  SubmitExchangeReceiptDto,
  AdminExchangeReceiptsQueryDto,
  AdminReviewExchangeReceiptDto,
  CreateExchangeReceiptUploadDto,
  CreateMonnifyExchangeDepositDto,
  CreateExchangePayoutDto,
  AdminExchangePayoutsQueryDto,
  AdminReviewPayoutDto,
  AdminMarkPayoutSentDto,
} from './dto/exchange.dto';
import { CreateRateAlertDto } from './dto/rate-alert.dto';

@Controller('exchange')
@UseGuards(JwtAuthGuard)
export class ExchangeController {
  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly rateService: RateService,
    private readonly rateAlertService: RateAlertService,
  ) {}

  @Get('rate')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getRate(
    @Query() query: GetRateDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.exchangeService.getRate(query.from, query.to);
    if (result.isStale) {
      res.setHeader('X-Rate-Stale', 'true');
    }
    return result;
  }

  @Post('quote')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createQuote(
    @CurrentUser() user: { userId: string },
    @Body() createQuoteDto: CreateQuoteDto,
  ) {
    return this.exchangeService.createQuote(user.userId, createQuoteDto);
  }

  @Post('execute')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async executeQuote(
    @CurrentUser() user: { userId: string },
    @Body() executeQuoteDto: ExecuteQuoteDto,
  ) {
    return this.exchangeService.executeQuote(user.userId, executeQuoteDto);
  }

  @Post('receipts')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async submitManualReceipt(
    @CurrentUser() user: { userId: string },
    @Body() dto: SubmitExchangeReceiptDto,
  ) {
    return this.exchangeService.submitManualReceipt(user.userId, dto);
  }

  @Post('monnify-deposit-intents')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async createMonnifyExchangeDepositIntent(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateMonnifyExchangeDepositDto,
  ) {
    return this.exchangeService.createMonnifyExchangeDepositIntent(
      user.userId,
      dto,
    );
  }

  @Post('receipts/upload-url')
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  async createManualReceiptUploadUrl(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateExchangeReceiptUploadDto,
  ) {
    return this.exchangeService.createManualReceiptUploadUrl(user.userId, dto);
  }

  @Get('receipts')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getManualReceipts(@CurrentUser() user: { userId: string }) {
    return this.exchangeService.getManualReceipts(user.userId);
  }

  @Get('receipts/:receiptId/proof-url')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async createManualReceiptProofUrl(
    @CurrentUser() user: { userId: string },
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    return this.exchangeService.createManualReceiptProofUrl(
      receiptId,
      user.userId,
    );
  }

  @Post('alerts')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createRateAlert(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateRateAlertDto,
  ) {
    return this.rateAlertService.createAlert(user.userId, dto);
  }

  @Get('alerts')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getRateAlerts(@CurrentUser() user: { userId: string }) {
    return this.rateAlertService.getUserAlerts(user.userId);
  }

  @Post('alerts/:alertId/delete')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async deleteRateAlert(
    @CurrentUser() user: { userId: string },
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    return this.rateAlertService.deleteAlert(alertId, user.userId);
  }

  @Post('rates')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async updateRate(
    @CurrentUser() user: { userId: string },
    @Body() dto: AdminUpdateRateDto,
  ) {
    // Admin rates are applied immediately. The audit log still records the
    // actor and before/after values, while the customer-facing rate remains a
    // single, predictable value that operators can update as markets move.
    const markup = dto.markup ?? 0;
    const persisted = await this.rateService.setManualRate(
      dto.from,
      dto.to,
      dto.rate,
      markup,
      user.userId,
      dto.reason?.trim() || undefined,
    );
    const effectiveRate = persisted.rate * (1 - persisted.markup / 100);
    return {
      success: true,
      from: dto.from,
      to: dto.to,
      rate: persisted.rate,
      markup: persisted.markup,
      effectiveRate,
      message: `Rate updated for ${dto.from}/${dto.to}`,
    };
  }

  @Post('payouts')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async createPayout(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateExchangePayoutDto,
  ) {
    return this.exchangeService.createPayout(user.userId, dto);
  }

  @Get('payouts')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getUserPayouts(@CurrentUser() user: { userId: string }) {
    return this.exchangeService.getUserPayouts(user.userId);
  }
}

@Controller('admin/exchange')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminExchangeController {
  constructor(private readonly exchangeService: ExchangeService) {}

  @Get('receipts')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getManualReceipts(@Query() query: AdminExchangeReceiptsQueryDto) {
    return this.exchangeService.getAdminManualReceipts(
      query.limit,
      query.status,
    );
  }

  @Post('receipts/:receiptId/review')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async reviewManualReceipt(
    @CurrentUser() user: { userId: string },
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Body() dto: AdminReviewExchangeReceiptDto,
  ) {
    return this.exchangeService.reviewManualReceipt(
      receiptId,
      user.userId,
      dto,
    );
  }

  @Post('receipts/:receiptId/proof-url')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async createManualReceiptProofUrl(
    @CurrentUser() user: { userId: string },
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    return this.exchangeService.createAdminManualReceiptProofUrl(
      receiptId,
      user.userId,
    );
  }

  @Get('payouts/stats')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getPayoutStats() {
    return this.exchangeService.getAdminPayoutStats();
  }

  @Get('payouts')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getPayouts(@Query() query: AdminExchangePayoutsQueryDto) {
    return this.exchangeService.getAdminPayouts(query.limit, query.status);
  }

  @Post('payouts/:payoutId/approve')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async approvePayout(
    @CurrentUser() user: { userId: string },
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: AdminReviewPayoutDto,
  ) {
    return this.exchangeService.approvePayout(payoutId, user.userId, dto);
  }

  @Post('payouts/:payoutId/mark-sent')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async markPayoutSent(
    @CurrentUser() user: { userId: string },
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: AdminMarkPayoutSentDto,
  ) {
    return this.exchangeService.markPayoutSent(payoutId, user.userId, dto);
  }

  @Get('rates/pending-overrides')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getPendingRateOverrides() {
    return this.exchangeService.getPendingRateOverrides();
  }

  @Post('rates/pending-overrides/:overrideId/review')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async reviewRateOverride(
    @CurrentUser() user: { userId: string },
    @Param('overrideId', ParseUUIDPipe) overrideId: string,
    @Body() dto: AdminApproveRateOverrideDto,
  ) {
    return this.exchangeService.reviewRateOverride(
      overrideId,
      user.userId,
      dto,
    );
  }
}
