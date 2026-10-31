import { createRequestAuditContext } from '../common/services/request-audit-context';
import type { AuthenticatedRequest } from '../common/types/request-context';
import { ProviderNotificationsService } from './provider-notifications.service';
import {
  Query,
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
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProviderExchangeService } from './provider-exchange.service';
import { ProviderExchangeSettlementService } from './provider-exchange-settlement.service';
import {
  ProviderExchangeQuoteDto,
  ProviderOrdersQueryDto,
  CreateProviderExchangeDto,
} from './dto/provider-exchange.dto';
import { KoraReleaseDto } from '../kora/dto/kora.dto';
import { KoraCapabilitiesService } from '../kora/kora-capabilities.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('exchange/provider')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class ProviderExchangeController {
  constructor(
    private readonly exchange: ProviderExchangeService,
    private readonly settlement: ProviderExchangeSettlementService,
    private readonly capabilities: KoraCapabilitiesService,
  ) {}
  @Get('config') async config(@CurrentUser() user: { userId: string }) {
    return {
      enabled: this.exchange.enabled(),
      hasOrders: (await this.exchange.list(user.userId)).length > 0,
      ghanaEnabled: this.capabilities.get().enabled,
      sourceCurrencies: ['GHS', 'NGN'],
      externalCurrencies: ['GHS'],
      ghana: this.capabilities.get(),
    };
  }
  @Get('quotes/:id')
  getQuote(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exchange.getQuote(user.userId, id);
  }
  @Post('quotes/:id/recover') recoverQuote(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exchange.recoverQuote(user.userId, id);
  }
  @Post('quotes')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  quote(
    @CurrentUser() user: { userId: string },
    @Body() dto: ProviderExchangeQuoteDto,
  ) {
    return this.exchange.quote(user.userId, dto);
  }
  @Post('orders')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateProviderExchangeDto,
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
  ) {
    return this.exchange.create(
      user.userId,
      dto.quoteId,
      dto.transactionPin,
      key,
      createRequestAuditContext(request, {
        actorId: user.userId,
        idempotencyKey: key,
      }),
    );
  }
  @Get('orders') list(@CurrentUser() user: { userId: string }) {
    return this.exchange.list(user.userId);
  }
  @Get('orders/:id') get(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exchange.get(user.userId, id);
  }
  @Post('orders/:id/refresh') async refresh(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const order = await this.exchange.get(user.userId, id);
    if (order.payoutReference)
      await this.settlement.reconcile(order.payoutReference);
    return this.exchange.get(user.userId, id);
  }
}
@Controller('admin/exchange/provider')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class AdminProviderExchangeController {
  constructor(
    private readonly exchange: ProviderExchangeService,
    private readonly settlement: ProviderExchangeSettlementService,
    private readonly prisma: PrismaService,
    private readonly notificationService: ProviderNotificationsService,
  ) {}
  @Get('orders') list(@Query() query: ProviderOrdersQueryDto) {
    return this.exchange.listAdmin(query);
  }
  @Get('notifications') notifications(@CurrentUser() user: { userId: string }) {
    return this.notificationService.list(user.userId);
  }
  @Post('notifications/:id/read') readNotification(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string,
  ) {
    return this.notificationService.read(user.userId, id, key);
  }
  @Post('orders/:id/send')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  send(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KoraReleaseDto,
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
  ) {
    return this.settlement.release(
      id,
      user.userId,
      dto.reason,
      key,
      dto.honorExpiredQuote,
      createRequestAuditContext(request, {
        actorId: user.userId,
        idempotencyKey: key,
      }),
    );
  }
  @Post('orders/:id/refresh') async refresh(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const order = await this.prisma.providerExchangeOrder.findUniqueOrThrow({
      where: { id },
    });
    if (order.payoutReference)
      await this.settlement.reconcile(order.payoutReference);
    return { refreshed: true };
  }
}
