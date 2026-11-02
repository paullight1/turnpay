import {
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
import { ProviderNotificationsService } from '../exchange/provider-notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: ProviderNotificationsService) {}
  @Get('unread-count')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async unreadCount(@CurrentUser() user: { userId: string }) {
    return {
      unreadCount: await this.notifications.countUnread(
        user.userId,
        `USER:${user.userId}`,
      ),
    };
  }
  @Get()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  list(@CurrentUser() user: { userId: string }) {
    return this.notifications.list(user.userId, `USER:${user.userId}`);
  }
  @Post(':id/read')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  read(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') legacyKey?: string,
  ) {
    return this.notifications.read(
      user.userId,
      id,
      key ?? legacyKey ?? '',
      `USER:${user.userId}`,
    );
  }
}
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminNotificationsController {
  constructor(private readonly notifications: ProviderNotificationsService) {}
  @Get('unread-count')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async unreadCount(@CurrentUser() user: { userId: string }) {
    return { unreadCount: await this.notifications.countUnread(user.userId) };
  }
  @Get()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  list(@CurrentUser() user: { userId: string }) {
    return this.notifications.list(user.userId);
  }
  @Post(':id/read')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  read(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') legacyKey?: string,
  ) {
    return this.notifications.read(user.userId, id, key ?? legacyKey ?? '');
  }
}
