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
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test', 'staging')
          .default('development'),
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().required(),
        SUPABASE_URL: Joi.string().required(),
        SUPABASE_ANON_KEY: Joi.string().required(),
        SUPABASE_SERVICE_ROLE_KEY: Joi.string().optional(),
        SUPABASE_JWT_SECRET: Joi.string().optional(),
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
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
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
