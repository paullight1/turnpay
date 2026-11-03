import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ProviderNotificationsService } from '../exchange/provider-notifications.service';
import {
  NotificationsController,
  AdminNotificationsController,
} from './notifications.controller';
import { AccountNotificationsService } from './account-notifications.service';
import {
  DisabledEmailTransport,
  EMAIL_OUTBOX_SETTINGS,
  EmailOutboxSettings,
  readEmailOutboxSettings,
  ResendEmailTransport,
  SmtpEmailTransport,
  TransactionalEmailOutboxService,
  TRANSACTIONAL_EMAIL_TRANSPORT,
} from './email-outbox.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [
    ProviderNotificationsService,
    AccountNotificationsService,
    {
      provide: EMAIL_OUTBOX_SETTINGS,
      inject: [ConfigService],
      useFactory: readEmailOutboxSettings,
    },
    {
      provide: TRANSACTIONAL_EMAIL_TRANSPORT,
      inject: [EMAIL_OUTBOX_SETTINGS],
      useFactory: (settings: EmailOutboxSettings) => {
        if (!settings.enabled) return new DisabledEmailTransport();
        if (settings.provider === 'resend' && settings.resendApiKey)
          return new ResendEmailTransport(settings.resendApiKey);
        if (settings.provider === 'smtp' && settings.smtp)
          return new SmtpEmailTransport(settings.smtp);
        return new DisabledEmailTransport();
      },
    },
    TransactionalEmailOutboxService,
  ],
  exports: [
    ProviderNotificationsService,
    AccountNotificationsService,
    TransactionalEmailOutboxService,
  ],
})
export class NotificationsModule {}
