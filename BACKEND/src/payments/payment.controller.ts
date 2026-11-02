import { PaystackFundingService } from './paystack-funding.service';
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Param,
  Headers,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  AuthorizeWithdrawalDto,
  InitializePaymentDto,
  PaymentReferenceDto,
  WithdrawDto,
  ResolveBankDto,
} from './dto/payment.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly funding: PaystackFundingService,
  ) {}

  @Get('capabilities')
  capabilities() {
    return this.funding.capabilities();
  }

  @Post('initialize')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  initialize(
    @CurrentUser() user: { userId: string },
    @Body() dto: InitializePaymentDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.funding.initialize(user.userId, dto.amount, key);
  }

  @Get('verify/:reference')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  verify(
    @CurrentUser() user: { userId: string },
    @Param() params: PaymentReferenceDto,
  ) {
    return this.funding.verify(user.userId, params.reference);
  }

  @Post('withdraw')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async withdraw(
    @CurrentUser() user: { userId: string },
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') legacyKey?: string,
  ) {
    return this.paymentService.withdraw(
      user.userId,
      dto,
      key ?? legacyKey ?? '',
    );
  }

  @Get('withdrawals/:reference')
  async getWithdrawal(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
  ) {
    return this.paymentService.getWithdrawal(user.userId, reference);
  }

  @Post('withdrawals/:reference/authorize')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async authorizeWithdrawal(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
    @Body() dto: AuthorizeWithdrawalDto,
  ) {
    return this.paymentService.authorizeWithdrawal(
      user.userId,
      reference,
      dto.authorizationCode,
    );
  }

  @Post('withdrawals/:reference/resend-otp')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async resendWithdrawalOtp(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
  ) {
    return this.paymentService.resendWithdrawalOtp(user.userId, reference);
  }

  @Get('banks')
  async listBanks() {
    return this.paymentService.listBanks();
  }

  @Post('banks/resolve')
  async resolveBank(@Body() dto: ResolveBankDto) {
    return this.paymentService.resolveBank(dto);
  }
}
