import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResolvePaymentAttemptDto } from './payment-attempts.dto';
import { PaymentAttemptsService } from './payment-attempts.service';

@Controller('payment-attempts')
@UseGuards(JwtAuthGuard)
export class PaymentAttemptsController {
  constructor(private readonly service: PaymentAttemptsService) {}
  @Post('resolve')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  resolve(
    @CurrentUser() user: { userId: string },
    @Body() dto: ResolvePaymentAttemptDto,
  ) {
    return this.service.resolve(user.userId, dto);
  }
}
