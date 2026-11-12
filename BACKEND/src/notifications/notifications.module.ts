import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseModule } from '../supabase/supabase.module';
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
import { EMAIL_RECIPIENT_VERIFIER } from './email-recipient-verifier';
import { SupabaseEmailRecipientVerifier } from './supabase-email-recipient-verifier';

@Module({
  imports: [PrismaModule, ConfigModule, SupabaseModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [
    ProviderNotificationsService,
    AccountNotificationsService,
    SupabaseEmailRecipientVerifier,
    {
      provide: EMAIL_RECIPIENT_VERIFIER,
      useExisting: SupabaseEmailRecipientVerifier,
    },
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
