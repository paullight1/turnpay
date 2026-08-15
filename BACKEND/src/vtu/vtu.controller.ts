import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Query,
  Param,
} from '@nestjs/common';
import { VtuService } from './vtu.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  AutoDetectReloadlyOperatorDto,
  GetVtuCountriesDto,
  GetVtuPackagesDto,
  GetVtuProvidersDto,
  PurchaseVtuDto,
  ValidateVtuCustomerDto,
  VtuOrderReferenceDto,
} from './dto/vtu.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('vtu')
@UseGuards(JwtAuthGuard)
export class VtuController {
  constructor(private readonly vtuService: VtuService) {}

  @Get('providers')
  async getProviders(@Query() query: GetVtuProvidersDto) {
    return this.vtuService.getProviders(
      query.type,
      query.scope,
      query.countryCode,
    );
  }

  @Get('countries')
  async getCountries(@Query() query: GetVtuCountriesDto) {
    return this.vtuService.getCountries(query.search);
  }

  @Get('operators/auto-detect')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async autoDetectOperator(@Query() query: AutoDetectReloadlyOperatorDto) {
    return this.vtuService.autoDetectReloadlyOperator(query);
  }

  @Get('packages')
  async getPackages(@Query() query: GetVtuPackagesDto) {
    return this.vtuService.getPackages(query.provider);
  }

  @Post('validate/smartcard')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async validateSmartCard(@Query() query: ValidateVtuCustomerDto) {
    return this.vtuService.validateSmartCard(query.provider, query.number);
  }

  @Post('validate/meter')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async validateMeter(@Query() query: ValidateVtuCustomerDto) {
    return this.vtuService.validateMeter(query.provider, query.number);
  }

  @Post('purchase')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async purchase(
    @CurrentUser() user: { userId: string },
    @Body() dto: PurchaseVtuDto,
  ) {
    return this.vtuService.purchase(user.userId, dto);
  }

  @Get('orders/:reference')
  async getOrderStatus(
    @CurrentUser() user: { userId: string },
    @Param() params: VtuOrderReferenceDto,
  ) {
    return this.vtuService.getOrderStatus(user.userId, params.reference);
  }

  @Post('orders/:reference/requery')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async requeryOrder(
    @CurrentUser() user: { userId: string },
    @Param() params: VtuOrderReferenceDto,
  ) {
    const order = await this.vtuService.getOrderStatus(
      user.userId,
      params.reference,
    );
    await this.vtuService.requeryOrder(order.orderId);
    return this.vtuService.getOrderStatus(user.userId, order.orderId);
  }
}
