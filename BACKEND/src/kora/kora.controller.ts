import { createRequestAuditContext } from '../common/services/request-audit-context';
import type { AuthenticatedRequest } from '../common/types/request-context';
import { GhsWithdrawalsService } from './ghs-withdrawals.service';
import { KoraPayoutsService } from './kora-payouts.service';
import { GhsWithdrawDto, KoraRecipientDto } from './dto/kora.dto';
import {
  Req,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { KoraCapabilitiesService } from './kora-capabilities.service';
import { KoraAccountsService } from './kora-accounts.service';
import { KoraCollectionsService } from './kora-collections.service';
import {
  KoraAccountRequestDto,
  KoraMomoIntentDto,
  KoraOtpDto,
} from './dto/kora.dto';
@Controller('ghana')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 15, ttl: 60000 } })
export class KoraController {
  constructor(
    private readonly capabilities: KoraCapabilitiesService,
    private readonly accounts: KoraAccountsService,
    private readonly collections: KoraCollectionsService,
    private readonly withdrawals: GhsWithdrawalsService,
    private readonly payouts: KoraPayoutsService,
  ) {}
  @Get('capabilities') getCapabilities() {
    return this.capabilities.get();
  }
  @Get('account') account(@CurrentUser() user: { userId: string }) {
    return this.accounts.refreshAccount(user.userId);
  }
  @Post('account')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  createAccount(
    @CurrentUser() user: { userId: string },
    @Body() _dto: KoraAccountRequestDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.accounts.ensureAccount(user.userId, key);
  }
  @Post('collections')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  collect(
    @CurrentUser() user: { userId: string },
    @Body() dto: KoraMomoIntentDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.collections.createMomoIntent(
      user.userId,
      dto.orderId,
      dto,
      key,
    );
  }
  @Get('collections/:id') getCollection(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.collections.getIntent(user.userId, id);
  }
  @Post('collections/:id/refresh') refresh(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.collections.refreshIntent(user.userId, id);
  }
  @Post('collections/:id/authorize')
  @Throttle({ default: { limit: 3, ttl: 600000 } })
  authorize(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KoraOtpDto,
  ) {
    return this.collections.authorizeIntent(user.userId, id, dto.otp);
  }
  @Get('operators') operators() {
    return this.capabilities.get().enabled ? this.payouts.operators() : [];
  }
  @Post('recipients/resolve')
  resolveRecipient(@Body() dto: KoraRecipientDto) {
    return this.payouts.resolveRecipient(dto.mobileNumber, dto.operator);
  }
  @Post('withdrawals')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  withdraw(
    @CurrentUser() user: { userId: string },
    @Body() dto: GhsWithdrawDto,
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
  ) {
    return this.withdrawals.create(
      user.userId,
      dto,
      key,
      createRequestAuditContext(request, {
        actorId: user.userId,
        idempotencyKey: key,
      }),
    );
  }
  @Get('withdrawals/:reference') cashout(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
  ) {
    return this.withdrawals.get(user.userId, reference);
  }
  @Post('withdrawals/:reference/refresh') async refreshCashout(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
  ) {
    await this.withdrawals.get(user.userId, reference);
    await this.withdrawals.reconcile(reference);
    return this.withdrawals.get(user.userId, reference);
  }
}
