import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import * as Joi from "joi";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { WalletsModule } from "./wallets/wallets.module";
import { OtpModule } from "./otp/otp.module";
import { ExchangeModule } from "./exchange/exchange.module";
import { PaymentsModule } from "./payments/payments.module";
import { VtuModule } from "./vtu/vtu.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { HealthModule } from "./health/health.module";
import { RedisModule } from "./redis/redis.module";
import { CircuitBreakerModule } from "./common/services/circuit-breaker.module";
import { ReconciliationModule } from "./common/services/reconciliation.module";
import { TransactionPinModule } from "./common/services/transaction-pin.module";
import { AdminModule } from "./admin/admin.module";
import { KycModule } from "./kyc/kyc.module";
import { SupabaseModule } from "./supabase/supabase.module";
import { BankingModule } from "./banking/banking.module";
import { TransfersModule } from "./transfers/transfers.module";
import { SupportModule } from "./support/support.module";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { IdempotencyInterceptor } from "./common/interceptors/idempotency.interceptor";

const deployedEnvironment = Joi.valid("production", "staging");
const defaultNodeEnv =
  process.env.WEB_CONCURRENCY || process.env.RENDER_WEB_CONCURRENCY
    ? "staging"
    : "development";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", ".env.example"],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid("development", "production", "test", "staging")
          .empty("")
          .default(defaultNodeEnv),
        PORT: Joi.number().empty("").default(3000),
        DATABASE_URL: Joi.when("NODE_ENV", {
          is: deployedEnvironment,
          then: Joi.string()
            .uri({ scheme: ["postgres", "postgresql"] })
            .required(),
          otherwise: Joi.string()
            .empty("")
            .uri({ scheme: ["postgres", "postgresql"] })
            .default(
              "postgresql://trustpay:trustpay_secret@localhost:5432/trustpay_db?schema=public",
            ),
        }),
        WEB_URL: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string()
            .uri({ scheme: ["https"] })
            .required(),
          otherwise: Joi.string().uri().default("http://localhost:3001"),
        }),
        ADMIN_URL: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string()
            .uri({ scheme: ["https"] })
            .required(),
          otherwise: Joi.string().uri().default("http://localhost:3002"),
        }),
        SUPABASE_URL: Joi.string().uri().required(),
        SUPABASE_PUBLISHABLE_KEY: Joi.string().allow("").optional(),
        SUPABASE_ANON_KEY: Joi.string().allow("").optional(),
        SUPABASE_SERVICE_ROLE_KEY: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().min(1).required(),
          otherwise: Joi.string().allow("").optional(),
        }),
        SUPABASE_JWT_SECRET: Joi.string().allow("").optional(),
        KYC_DOCUMENT_BUCKET: Joi.string().default("kyc-documents"),
        KYC_ADMIN_DOCUMENT_URL_TTL_SECONDS: Joi.number()
          .empty("")
          .min(60)
          .max(900)
          .default(300),
        EXCHANGE_RECEIPT_BUCKET: Joi.string().default("exchange-receipts"),
        EXCHANGE_RECEIPT_PROOF_URL_TTL_SECONDS: Joi.number()
          .empty("")
          .min(60)
          .max(900)
          .default(300),
        MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER: Joi.string()
          .allow("")
          .optional(),
        REDIS_URL: Joi.when("NODE_ENV", {
          is: deployedEnvironment,
          then: Joi.string()
            .uri({ scheme: ["redis", "rediss"] })
            .required(),
          otherwise: Joi.string()
            .uri({ scheme: ["redis", "rediss"] })
            .allow("")
            .optional(),
        }),
        REDIS_HOST: Joi.string().empty("").default("localhost"),
        REDIS_PORT: Joi.number().empty("").default(6379),
        REDIS_PASSWORD: Joi.string().allow("").optional(),
        OTP_EXPIRES_IN: Joi.string().allow("").optional(),
        OTP_LENGTH: Joi.string().allow("").optional(),
        OTP_DEV_CODE: Joi.string().allow("").optional(),
        PAYSTACK_SECRET_KEY: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().min(1).required(),
          otherwise: Joi.string().allow("").optional(),
        }),
        PAYSTACK_PUBLIC_KEY: Joi.string().allow("").optional(),
        PAYSTACK_WEBHOOK_URL: Joi.string().allow("").optional(),
        PAYSTACK_WEBHOOK_SECRET: Joi.string().allow("").optional(),
        PAYSTACK_DVA_PREFERRED_BANK: Joi.string().default("test-bank"),
        FLUTTERWAVE_SECRET_KEY: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().min(1).required(),
          otherwise: Joi.string().allow("").optional(),
        }),
        FLUTTERWAVE_PUBLIC_KEY: Joi.string().allow("").optional(),
        FLUTTERWAVE_ENCRYPTION_KEY: Joi.string().allow("").optional(),
        FLUTTERWAVE_SECRET_HASH: Joi.string().allow("").optional(),
        BANKING_ENABLED: Joi.boolean()
          .truthy("true")
          .falsy("false")
          .default(false),
        VIRTUAL_ACCOUNTS_ENABLED: Joi.boolean()
          .truthy("true")
          .falsy("false")
          .default(false),
        WITHDRAWALS_ENABLED: Joi.boolean()
          .truthy("true")
          .falsy("false")
          .default(false),
        MONNIFY_API_KEY: Joi.string().allow("").optional(),
        MONNIFY_SECRET_KEY: Joi.string().allow("").optional(),
        MONNIFY_CONTRACT_CODE: Joi.string().allow("").optional(),
        MONNIFY_BASE_URL: Joi.string().uri().allow("").optional(),
        MONNIFY_WEBHOOK_SECRET: Joi.string().allow("").optional(),
        MONNIFY_WEBHOOK_URL: Joi.string().uri().allow("").optional(),
        MONNIFY_GET_ALL_AVAILABLE_BANKS: Joi.boolean()
          .truthy("true")
          .falsy("false")
          .default(true),
        MONNIFY_RESTRICT_PAYMENT_SOURCE: Joi.boolean()
          .truthy("true")
          .falsy("false")
          .default(false),
        MONNIFY_SANDBOX_TEST_KYC_BYPASS: Joi.boolean()
          .truthy("true")
          .falsy("false")
          .default(false),
        MONNIFY_TEST_BVN: Joi.string().allow("").optional(),
        MONNIFY_TEST_NIN: Joi.string().allow("").optional(),
        BANKING_PROVIDER_PRIMARY: Joi.string()
          .valid("monnify")
          .default("monnify"),
        BANKING_PROVIDER_FALLBACK: Joi.string().valid("").allow("").default(""),
        SUPPORTED_BANKING_CURRENCIES: Joi.string().default("NGN"),
        BANKING_SANDBOX_MODE: Joi.boolean()
          .truthy("true")
          .falsy("false")
          .default(true),
        PII_ENCRYPTION_KEY: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().allow("").optional(),
        }),
        PII_KEY_VERSION: Joi.string().default("1"),
        BANK_ACCOUNT_ENCRYPTION_KEY: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().allow("").optional(),
        }),
        TRANSACTION_PIN_REQUIRED: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.boolean().truthy("true").falsy("false").default(true),
          otherwise: Joi.boolean().truthy("true").falsy("false").default(false),
        }),
        VTU_PROVIDER: Joi.string()
          .valid("generic", "vtpass")
          .default("generic"),
        VTU_API_URL: Joi.string().uri().allow("").optional(),
        VTU_API_KEY: Joi.string().allow("").optional(),
        VTPASS_BASE_URL: Joi.string().uri().allow("").optional(),
        VTPASS_API_KEY: Joi.string().allow("").optional(),
        VTPASS_PUBLIC_KEY: Joi.string().allow("").optional(),
        VTPASS_SECRET_KEY: Joi.string().allow("").optional(),
        RELOADLY_ENABLED: Joi.boolean()
          .truthy("true")
          .falsy("false")
          .default(false),
        RELOADLY_AUTH_URL: Joi.string()
          .uri()
          .default("https://auth.reloadly.com/oauth/token"),
        RELOADLY_TOPUPS_BASE_URL: Joi.string()
          .uri()
          .default("https://topups-sandbox.reloadly.com"),
        RELOADLY_AUDIENCE: Joi.string()
          .uri()
          .default("https://topups-sandbox.reloadly.com"),
        RELOADLY_UTILITIES_BASE_URL: Joi.string()
          .uri()
          .default("https://utilities-sandbox.reloadly.com"),
        RELOADLY_UTILITIES_AUDIENCE: Joi.string()
          .uri()
          .default("https://utilities-sandbox.reloadly.com"),
        RELOADLY_CLIENT_ID: Joi.string().allow("").optional(),
        RELOADLY_CLIENT_SECRET: Joi.string().allow("").optional(),
        RELOADLY_SENDER_COUNTRY_CODE: Joi.string().default("NG"),
        RELOADLY_WEBHOOK_SECRET: Joi.string().allow("").optional(),
        RELOADLY_WEBHOOK_URL: Joi.string().uri().allow("").optional(),
      }),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['set-cookie']",
            "req.headers['x-api-key']",
            "req.headers['x-auth-token']",
            "res.headers['set-cookie']",
          ],
          censor: "[REDACTED]",
        },
        level:
          process.env.LOG_LEVEL ||
          (process.env.NODE_ENV === "production" ? "info" : "debug"),
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
