import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProviderNotificationsService } from '../exchange/provider-notifications.service';
import {
  NotificationsController,
  AdminNotificationsController,
} from './notifications.controller';
@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [ProviderNotificationsService],
  exports: [ProviderNotificationsService],
})
export class NotificationsModule {}
