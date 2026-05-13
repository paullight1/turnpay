import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ExchangeService } from './exchange.service';
import { RateService } from './providers/rate.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateQuoteDto,
  ExecuteQuoteDto,
  AdminUpdateRateDto,
} from './dto/exchange.dto';

@Controller('exchange')
@UseGuards(JwtAuthGuard)
export class ExchangeController {
  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly rateService: RateService,
  ) {}

  @Get('rate')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getRate(@Query() query: { from: string; to: string }) {
    return this.exchangeService.getRate(query.from, query.to);
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

  @Post('rates')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async updateRate(@Body() dto: AdminUpdateRateDto) {
    await this.rateService.setManualRate(
      dto.from,
      dto.to,
      dto.rate,
      dto.markup,
    );
    return { success: true, message: `Rate updated for ${dto.from}/${dto.to}` };
  }
}
