import { koraConfigurationFields } from './kora/kora-capabilities.service';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { RedisThrottlerStorage } from './common/services/redis-throttler.storage';
import { RedisService } from './redis/redis.service';
import { ScheduleModule } from '@nestjs/schedule';
import { scheduleOptions } from './common/services/schedule-options';
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
import { PaymentAttemptsModule } from './payment-attempts/payment-attempts.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { CircuitBreakerModule } from './common/services/circuit-breaker.module';
import { ReconciliationModule } from './common/services/reconciliation.module';
import { TransactionPinModule } from './common/services/transaction-pin.module';
import { AdminModule } from './admin/admin.module';
import { KycModule } from './kyc/kyc.module';
import { SupabaseModule } from './supabase/supabase.module';
import { BankingModule } from './banking/banking.module';
import { TransfersModule } from './transfers/transfers.module';
import { internalTransfersEnabledSchema } from './transfers/internal-transfers.config';
import { SupportModule } from './support/support.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { IdempotencyResponseCryptoService } from './common/services/idempotency-response-crypto.service';
import {
  HTTP_LOG_REDACTION_CENSOR,
  HTTP_LOG_REDACTION_PATHS,
} from './common/security/http-log-redaction';

const deployedEnvironment = Joi.valid('production', 'staging');
const defaultNodeEnv =
  process.env.WEB_CONCURRENCY || process.env.RENDER_WEB_CONCURRENCY
    ? 'staging'
    : 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load the real local env first so it wins over placeholder values in
      // the example template during development.
      envFilePath: ['.env', '.env.example'],
      validationSchema: Joi.object({
        ...koraConfigurationFields,
        NODE_ENV: Joi.string()
          .trim()
          .lowercase()
          .valid('development', 'production', 'test', 'staging')
          .empty('')
          .empty('value')
          .default(defaultNodeEnv),
        PORT: Joi.number().empty('').empty('value').default(3000),
        SENTRY_DSN: Joi.string()
          .uri({ scheme: ['https'] })
          .allow('')
          .optional(),
        DATABASE_URL: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string()
            .uri({ scheme: ['postgres', 'postgresql'] })
            .required(),
          otherwise: Joi.string()
            .empty('')
            .uri({ scheme: ['postgres', 'postgresql'] })
            .default(
              'postgresql://trustpay:trustpay_secret@localhost:5432/trustpay_db?schema=public',
            ),
        }),
        WEB_URL: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string()
            .uri({ scheme: ['https'] })
            .required(),
          otherwise: Joi.string().uri().default('http://localhost:3001'),
        }),
        ADMIN_URL: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string()
            .uri({ scheme: ['https'] })
            .required(),
          otherwise: Joi.string().uri().default('http://localhost:3002'),
        }),
        JWT_SECRET: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().default('dev_jwt_secret_do_not_use'),
        }),
        JWT_REFRESH_SECRET: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().default('dev_refresh_secret_do_not_use'),
        }),
        SUPABASE_URL: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string()
            .uri({ scheme: ['https'] })
            .required(),
          otherwise: Joi.string().uri().required(),
        }),
        SUPABASE_PUBLISHABLE_KEY: Joi.string().allow('').optional(),
        SUPABASE_ANON_KEY: Joi.string().allow('').optional(),
        SUPABASE_SERVICE_ROLE_KEY: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string().min(1).required(),
          otherwise: Joi.string().allow('').optional(),
        }),
        SUPABASE_JWT_SECRET: Joi.string().allow('').optional(),
        KYC_DOCUMENT_BUCKET: Joi.string().default('kyc-documents'),
        KYC_ADMIN_DOCUMENT_URL_TTL_SECONDS: Joi.number()
          .empty('')
          .min(60)
          .max(900)
          .default(300),
        NINJA_NIN_ENABLED: Joi.boolean().default(false),
        NINJA_SECRET_KEY: Joi.string().allow('').optional(),
        NINJA_BASE_URL: Joi.string()
          .valid(
            'https://api.ninja.boucloud.io',
            'https://api.sandbox.ninja.boucloud.io',
          )
          .default('https://api.ninja.boucloud.io'),
        TIER_ONE_NGN_PER_TRANSACTION: Joi.string().allow('').optional(),
        TIER_ONE_NGN_DAILY: Joi.string().allow('').optional(),
        TIER_ONE_NGN_MAX_BALANCE: Joi.string().allow('').optional(),
        KYC_PROVIDER: Joi.string()
          .trim()
          .lowercase()
          .valid('paystack', 'monnify')
          .default('paystack'),
        EXCHANGE_RECEIPT_BUCKET: Joi.string().default('exchange-receipts'),
        FX_RATE_SOURCE: Joi.string().valid('admin', 'api').default('admin'),
        MANUAL_EXCHANGE_ENABLED: Joi.boolean().default(false),
        MANUAL_EXCHANGE_COLLECTION_BANK_NAME: Joi.when(
          'MANUAL_EXCHANGE_ENABLED',
          {
            is: true,
            then: Joi.string().trim().max(100).required(),
            otherwise: Joi.string().allow('').optional(),
          },
        ),
        MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NAME: Joi.when(
          'MANUAL_EXCHANGE_ENABLED',
          {
            is: true,
            then: Joi.string().trim().max(150).required(),
            otherwise: Joi.string().allow('').optional(),
          },
        ),
        MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NUMBER: Joi.when(
          'MANUAL_EXCHANGE_ENABLED',
          {
            is: true,
            then: Joi.string()
              .pattern(/^\d{10}$/)
              .required(),
            otherwise: Joi.string().allow('').optional(),
          },
        ),
        MANUAL_EXCHANGE_COLLECTION_VERSION: Joi.when(
          'MANUAL_EXCHANGE_ENABLED',
          {
            is: true,
            then: Joi.string().trim().max(100).required(),
            otherwise: Joi.string().allow('').optional(),
          },
        ),
        EXCHANGE_RECEIPT_PROOF_URL_TTL_SECONDS: Joi.number()
          .empty('')
          .min(60)
          .max(900)
          .default(300),
        MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER: Joi.string()
          .allow('')
          .optional(),
        REDIS_URL: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string()
            .uri({ scheme: ['redis', 'rediss'] })
            .required(),
          otherwise: Joi.string()
            .uri({ scheme: ['redis', 'rediss'] })
            .allow('')
            .optional(),
        }),
        REDIS_HOST: Joi.string().empty('').default('localhost'),
        REDIS_PORT: Joi.number().empty('').default(6379),
        REDIS_PASSWORD: Joi.string().allow('').optional(),
        REDIS_ALLOW_MEMORY_FALLBACK: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.boolean()
            .truthy('true')
            .falsy('false')
            .valid(false)
            .default(false),
          otherwise: Joi.boolean().truthy('true').falsy('false').default(false),
        }),
        TRUST_PROXY_HOPS: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.number().integer().min(1).max(2).required(),
          otherwise: Joi.number().integer().min(0).max(2).default(0),
        }),
        OTP_EXPIRES_IN: Joi.string()
          .empty('')
          .pattern(/^(?:[1-5]m?|(?:[1-9]|[1-9]\d|[12]\d{2}|300)s)$/)
          .default('5m'),
        OTP_LENGTH: Joi.string().empty('').valid('6').default('6'),
        OTP_DEV_CODE: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string().valid('').optional(),
          otherwise: Joi.string()
            .allow('')
            .pattern(/^\d{6}$/)
            .optional(),
        }),
        OTP_PROVIDER: Joi.string()
          .valid('supabase_email')
          .default('supabase_email'),
        BANKING_ENABLED: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(true),
        VIRTUAL_ACCOUNTS_ENABLED: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(true),
        WITHDRAWALS_ENABLED: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(true),
        INTERNAL_TRANSFERS_ENABLED: internalTransfersEnabledSchema,
        PAYSTACK_SECRET_KEY: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string()
            .trim()
            .pattern(/^sk_live_[A-Za-z0-9]+$/)
            .allow('')
            .optional(),
          otherwise: Joi.string()
            .trim()
            .pattern(/^sk_(test|live)_[A-Za-z0-9]+$/)
            .allow('')
            .optional(),
        }),
        PAYSTACK_DVA_PREFERRED_BANK: Joi.string()
          .trim()
          .max(64)
          .allow('')
          .optional(),
        PAYSTACK_CHECKOUT_ENABLED: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(true),
        PAYSTACK_FUNDING_ALLOWED_CHANNELS: Joi.string()
          .trim()
          .pattern(
            /^(?:card|bank|apple_pay|ussd|qr|mobile_money|bank_transfer|eft|capitec_pay|payattitude)(?:,(?:card|bank|apple_pay|ussd|qr|mobile_money|bank_transfer|eft|capitec_pay|payattitude))*$/,
          )
          .default('bank_transfer'),
        MONNIFY_API_KEY: Joi.when('KYC_PROVIDER', {
          is: 'monnify',
          then: Joi.when('NODE_ENV', {
            is: deployedEnvironment,
            then: Joi.string().trim().min(1).required(),
            otherwise: Joi.string().allow('').optional(),
          }),
          otherwise: Joi.string().allow('').optional(),
        }),
        MONNIFY_SECRET_KEY: Joi.when('KYC_PROVIDER', {
          is: 'monnify',
          then: Joi.when('NODE_ENV', {
            is: deployedEnvironment,
            then: Joi.string().trim().min(1).required(),
            otherwise: Joi.string().allow('').optional(),
          }),
          otherwise: Joi.string().allow('').optional(),
        }),
        MONNIFY_CONTRACT_CODE: Joi.string().allow('').optional(),
        MONNIFY_BASE_URL: Joi.string().uri().allow('').optional(),
        MONNIFY_WEBHOOK_URL: Joi.string().uri().allow('').optional(),
        MONNIFY_GET_ALL_AVAILABLE_BANKS: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(true),
        MONNIFY_RESTRICT_PAYMENT_SOURCE: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(false),
        MONNIFY_SANDBOX_TEST_KYC_BYPASS: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(false),
        MONNIFY_TEST_BVN: Joi.string().allow('').optional(),
        MONNIFY_TEST_NIN: Joi.string().allow('').optional(),
        BANKING_PROVIDER_PRIMARY: Joi.string()
          .valid('paystack', 'monnify')
          .default('paystack'),
        VIRTUAL_ACCOUNT_NAME_PREFIX: Joi.string()
          .max(24)
          .allow('')
          .default('TrustPay'),
        BANKING_PROVIDER_FALLBACK: Joi.string().valid('').allow('').default(''),
        SUPPORTED_BANKING_CURRENCIES: Joi.string().default('NGN'),
        BANKING_SANDBOX_MODE: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(true),
        PII_ENCRYPTION_KEY: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().allow('').optional(),
        }),
        PII_KEY_VERSION: Joi.string().default('1'),
        BANK_ACCOUNT_ENCRYPTION_KEY: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().allow('').optional(),
        }),
        TRANSACTION_PIN_REQUIRED: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.boolean()
            .truthy('true')
            .falsy('false')
            .valid(true)
            .default(true),
          otherwise: Joi.boolean().truthy('true').falsy('false').default(false),
        }),
        IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string()
            .custom((value: string, helpers) =>
              Buffer.from(value, 'base64').length === 32
                ? value
                : helpers.error('any.invalid'),
            )
            .required(),
          otherwise: Joi.string().allow('').optional(),
        }),
        IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID: Joi.when('NODE_ENV', {
          is: deployedEnvironment,
          then: Joi.string().trim().max(64).required(),
          otherwise: Joi.string().trim().max(64).default('v1'),
        }),
        VTU_PROVIDER: Joi.string().valid('vtpass').default('vtpass'),
        VTU_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
        VTU_SIMULATION_ENABLED: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(false),
        VTU_KYC_BYPASS: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(false),
        VTPASS_BASE_URL: Joi.when('VTU_ENABLED', {
          is: true,
          then: Joi.when('NODE_ENV', {
            is: deployedEnvironment,
            then: Joi.string()
              .uri({ scheme: ['https'] })
              .required(),
            otherwise: Joi.string().uri().allow('').optional(),
          }),
          otherwise: Joi.string().allow('').optional(),
        }),
        VTPASS_API_KEY: Joi.when('VTU_ENABLED', {
          is: true,
          then: Joi.when('NODE_ENV', {
            is: deployedEnvironment,
            then: Joi.string().min(1).required(),
            otherwise: Joi.string().allow('').optional(),
          }),
          otherwise: Joi.string().allow('').optional(),
        }),
        VTPASS_PUBLIC_KEY: Joi.when('VTU_ENABLED', {
          is: true,
          then: Joi.when('NODE_ENV', {
            is: deployedEnvironment,
            then: Joi.string().min(1).required(),
            otherwise: Joi.string().allow('').optional(),
          }),
          otherwise: Joi.string().allow('').optional(),
        }),
        VTPASS_SECRET_KEY: Joi.when('VTU_ENABLED', {
          is: true,
          then: Joi.when('NODE_ENV', {
            is: deployedEnvironment,
            then: Joi.string().min(1).required(),
            otherwise: Joi.string().allow('').optional(),
          }),
          otherwise: Joi.string().allow('').optional(),
        }),
        VTPASS_WEBHOOK_SECRET: Joi.when('VTU_ENABLED', {
          is: true,
          then: Joi.when('NODE_ENV', {
            is: deployedEnvironment,
            then: Joi.string().min(16).required(),
            otherwise: Joi.string().allow('').optional(),
          }),
          otherwise: Joi.string().allow('').optional(),
        }),
        VTPASS_LOW_BALANCE_THRESHOLD: Joi.number().min(0).default(5000),
      }),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [...HTTP_LOG_REDACTION_PATHS],
          censor: HTTP_LOG_REDACTION_CENSOR,
        },
        level:
          process.env.LOG_LEVEL ||
          (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [RedisService, ConfigService],
      useFactory: (
        redisService: RedisService,
        configService: ConfigService,
      ) => ({
        throttlers: [
          {
            // Generous global ceiling so ordinary authenticated browsing is
            // never throttled; tight abuse limits are applied per-endpoint via
            // @Throttle (e.g. withdraw 5/min, provision 3/min). The global
            // guard uses a verified user identity when one is already present;
            // otherwise it falls back to the proxy-normalized client IP.
            ttl: 60000,
            limit: 120,
          },
          {
            name: 'verifiedUser',
            ttl: 60000,
            limit: 5,
          },
          {
            // Keep registration attempts isolated from the broad per-IP
            // request bucket. Allow extra retries during local development,
            // while retaining the stricter production ceiling.
            name: 'registration',
            ttl: 3600000,
            limit: configService.get('NODE_ENV') === 'production' ? 3 : 10,
          },
        ],
        // Redis-backed so limits survive restarts and are shared across
        // instances. Deployed environments fail closed when Redis is down.
        storage: new RedisThrottlerStorage(redisService),
        // Rate limiting would make request-count assertions in the e2e suite
        // flaky; it is only meaningful in real deployments.
        skipIf: () => process.env.NODE_ENV === 'test',
      }),
    }),
    ScheduleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        scheduleOptions(
          config.get<string>('NODE_ENV'),
          config.get<string>('DISABLE_SCHEDULED_JOBS'),
        ),
    }),
    RedisModule,
    CircuitBreakerModule,
    ReconciliationModule,
    TransactionPinModule,
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
    PaymentAttemptsModule,
    AdminModule,
    KycModule,
    BankingModule,
    TransfersModule,
    SupportModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    IdempotencyResponseCryptoService,
    IdempotencyInterceptor,
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule {}
