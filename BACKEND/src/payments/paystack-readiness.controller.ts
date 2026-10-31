import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PaystackFundingService } from './paystack-funding.service';

@Controller('admin/payments/paystack')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class PaystackReadinessController {
  constructor(private readonly funding: PaystackFundingService) {}

  @Get('readiness')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  readiness() {
    return this.funding.diagnostics();
  }
}
