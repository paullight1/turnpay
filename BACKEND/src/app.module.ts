import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import * as Joi from 'joi';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { OtpModule } from './otp/otp.module';
import { ExchangeModule } from './exchange/exchange.module';
import { PaymentsModule } from './payments/payments.module';
import { VtuModule } from './vtu/vtu.module';
import { TransactionsModule } from './transactions/transactions.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { CircuitBreakerModule } from './common/services/circuit-breaker.module';
import { ReconciliationModule } from './common/services/reconciliation.module';
import { AdminModule } from './admin/admin.module';
import { KycModule } from './kyc/kyc.module';
import { SupabaseModule } from './supabase/supabase.module';
import { BankingModule } from './banking/banking.module';
import { TransfersModule } from './transfers/transfers.module';
import { SupportModule } from './support/support.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test', 'staging')
          .empty('')
          .default('development'),
        PORT: Joi.number().empty('').default(3000),
        DATABASE_URL: Joi.string()
          .empty('')
          .default(
            'postgresql://trustpay:trustpay_secret@localhost:5432/trustpay_db?schema=public',
          ),
        SUPABASE_URL: Joi.string().required(),
        SUPABASE_PUBLISHABLE_KEY: Joi.string().allow('').optional(),
        SUPABASE_ANON_KEY: Joi.string().allow('').optional(),
        SUPABASE_SERVICE_ROLE_KEY: Joi.string().allow('').optional(),
        SUPABASE_JWT_SECRET: Joi.string().allow('').optional(),
        REDIS_HOST: Joi.string().empty('').default('localhost'),
        REDIS_PORT: Joi.number().empty('').default(6379),
        OTP_EXPIRES_IN: Joi.string().allow('').optional(),
        OTP_LENGTH: Joi.string().allow('').optional(),
        OTP_DEV_CODE: Joi.string().allow('').optional(),
        PAYSTACK_SECRET_KEY: Joi.string().allow('').optional(),
        PAYSTACK_PUBLIC_KEY: Joi.string().allow('').optional(),
        PAYSTACK_WEBHOOK_URL: Joi.string().allow('').optional(),
        PAYSTACK_WEBHOOK_SECRET: Joi.string().allow('').optional(),
        PAYSTACK_DVA_PREFERRED_BANK: Joi.string().default('test-bank'),
        FLUTTERWAVE_SECRET_KEY: Joi.string().allow('').optional(),
        FLUTTERWAVE_PUBLIC_KEY: Joi.string().allow('').optional(),
        FLUTTERWAVE_ENCRYPTION_KEY: Joi.string().allow('').optional(),
        FLUTTERWAVE_SECRET_HASH: Joi.string().allow('').optional(),
        BANKING_ENABLED: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(false),
        VIRTUAL_ACCOUNTS_ENABLED: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(false),
        WITHDRAWALS_ENABLED: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(false),
        BANKING_PROVIDER_PRIMARY: Joi.string().default('paystack'),
        BANKING_PROVIDER_FALLBACK: Joi.string().allow('').optional(),
        SUPPORTED_BANKING_CURRENCIES: Joi.string().default('NGN'),
        BANKING_SANDBOX_MODE: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(true),
        PII_ENCRYPTION_KEY: Joi.string().allow('').optional(),
        PII_KEY_VERSION: Joi.string().default('1'),
        BANK_ACCOUNT_ENCRYPTION_KEY: Joi.string().allow('').optional(),
      }),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        level: process.env.LOG_LEVEL || 'debug',
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    ScheduleModule.forRoot(),
    RedisModule,
    CircuitBreakerModule,
    ReconciliationModule,
    SupabaseModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    OtpModule,
    ExchangeModule,
    PaymentsModule,
    VtuModule,
    TransactionsModule,
    AdminModule,
    KycModule,
    BankingModule,
    TransfersModule,
    SupportModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, IdempotencyInterceptor],
})
export class AppModule {}
