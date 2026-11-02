import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Query,
  Param,
  Headers,
} from '@nestjs/common';
import { VtuService } from './vtu.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  GetVtuPackagesDto,
  VtuQuoteDto,
  ValidateSmileDto,
  InternationalCountryDto,
  GetVtuProvidersDto,
  PurchaseVtuDto,
  ValidateMeterDto,
  ValidateSmartCardDto,
  VtuOrderReferenceDto,
} from './dto/vtu.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('vtu')
@UseGuards(JwtAuthGuard)
export class VtuController {
  constructor(private readonly vtuService: VtuService) {}

  @Get('providers')
  async getProviders(@Query() query: GetVtuProvidersDto) {
    if (query.catalog === 'extended')
      return this.vtuService.getProviders(query.type, true);
    return this.vtuService.getProviders(query.type);
  }

  @Get('packages')
  async getPackages(@Query() query: GetVtuPackagesDto) {
    return this.vtuService.getPackages(query.provider, query);
  }

  @Get('international/countries')
  async getInternationalCountries() {
    return this.vtuService.getInternationalCountries();
  }

  @Get('international/operators')
  async getInternationalOperators(@Query() query: InternationalCountryDto) {
    return this.vtuService.getInternationalOperators(query.countryCode);
  }

  @Get('quote')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async quote(@Query() query: VtuQuoteDto) {
    return this.vtuService.quote(query);
  }

  @Post('validate/smile')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async validateSmile(@Body() dto: ValidateSmileDto) {
    return this.vtuService.validateSmile(dto.smileEmail);
  }

  @Post('validate/smartcard')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async validateSmartCard(@Body() dto: ValidateSmartCardDto) {
    return this.vtuService.validateSmartCard(dto);
  }

  @Post('validate/meter')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async validateMeter(@Body() dto: ValidateMeterDto) {
    return this.vtuService.validateMeter(dto);
  }

  @Post('purchase')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async purchase(
    @CurrentUser() user: { userId: string },
    @Body() dto: PurchaseVtuDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') legacyKey?: string,
  ) {
    return this.vtuService.purchase(user.userId, dto, key ?? legacyKey ?? '');
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
