import { Controller, Post, Get, Body, UseGuards, Param } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FundWalletDto, WithdrawDto, ResolveBankDto } from './dto/payment.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('fund')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async fundWallet(
    @CurrentUser() user: { userId: string },
    @Body() dto: FundWalletDto,
  ) {
    return this.paymentService.fundWallet(user.userId, dto);
  }

  @Post('withdraw')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async withdraw(
    @CurrentUser() user: { userId: string },
    @Body() dto: WithdrawDto,
  ) {
    return this.paymentService.withdraw(user.userId, dto);
  }

  @Get('withdrawals/:reference')
  async getWithdrawal(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
  ) {
    return this.paymentService.getWithdrawal(user.userId, reference);
  }

  @Get('verify/:reference')
  async verifyPayment(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
  ) {
    return this.paymentService.verifyPayment(reference, user.userId);
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
