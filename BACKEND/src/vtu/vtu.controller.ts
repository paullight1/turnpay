import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { VtuService } from './vtu.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PurchaseVtuDto } from './dto/vtu.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('vtu')
@UseGuards(JwtAuthGuard)
export class VtuController {
  constructor(private readonly vtuService: VtuService) {}

  @Get('providers')
  async getProviders(@Query('type') type?: string) {
    return this.vtuService.getProviders(type);
  }

  @Get('packages')
  async getPackages(@Query('provider') provider: string) {
    return this.vtuService.getPackages(provider);
  }

  @Post('validate/smartcard')
  async validateSmartCard(
    @Query('provider') provider: string,
    @Query('number') number: string,
  ) {
    return this.vtuService.validateSmartCard(provider, number);
  }

  @Post('validate/meter')
  async validateMeter(
    @Query('provider') provider: string,
    @Query('number') number: string,
  ) {
    return this.vtuService.validateMeter(provider, number);
  }

  @Post('purchase')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async purchase(
    @CurrentUser() user: { userId: string },
    @Body() dto: PurchaseVtuDto,
  ) {
    return this.vtuService.purchase(user.userId, dto);
  }
}
