import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('retired KYC provider production configuration', () => {
  const script = resolve(
    __dirname,
    '../../scripts/validate-production-config.sh',
  );
  const productionEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    SENTRY_DSN: 'https://ci-public@sentry.io/123456',
    DATABASE_URL:
      'postgresql://postgres.project-ref:test-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require&schema=public',
    WEB_URL: 'https://trustpay.example.com',
    ADMIN_URL: 'https://admin.trustpay.example.com',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
    REDIS_URL: 'rediss://default:test@redis.example.com:6379',
    REDIS_ALLOW_MEMORY_FALLBACK: 'false',
    TRUST_PROXY_HOPS: '1',
    OTP_EXPIRES_IN: '5m',
    OTP_LENGTH: '6',
    OTP_DEV_CODE: '',
    OTP_PROVIDER: 'supabase_email',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
    SUPABASE_ANON_KEY: '',
    IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID: 'v1',
    INTERNAL_TRANSFERS_ENABLED: 'false',
    TRANSACTION_PIN_REQUIRED: 'true',
    BANKING_ENABLED: 'false',
    BANKING_PROVIDER_PRIMARY: 'monnify',
    VIRTUAL_ACCOUNTS_ENABLED: 'false',
    WITHDRAWALS_ENABLED: 'false',
    PAYSTACK_CHECKOUT_ENABLED: 'false',
    KYC_PROVIDER: 'monnify',
    MONNIFY_API_KEY: 'test-monnify-api-key',
    MONNIFY_SECRET_KEY: 'test-monnify-secret-key',
    MONNIFY_BASE_URL: 'https://api.monnify.example.com',
    PII_ENCRYPTION_KEY: 'test-pii-key-with-at-least-32-characters',
    VTU_ENABLED: 'false',
    VTU_PROVIDER: 'vtpass',
    VTPASS_BASE_URL: 'https://vtpass.com/api',
    VTPASS_API_KEY: 'test-vtpass-api-key',
    VTPASS_PUBLIC_KEY: 'test-vtpass-public-key',
    VTPASS_SECRET_KEY: 'test-vtpass-secret-key',
    VTPASS_WEBHOOK_SECRET: 'test-vtpass-webhook-secret',
  };

  const validate = (overrides: NodeJS.ProcessEnv = {}) => {
    const env = { ...productionEnv, ...overrides };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete env[key];
    }
    return spawnSync(script, ['true'], { env, encoding: 'utf8' });
  };

  it('rejects every retired KYC provider', () => {
    for (const provider of ['ninja', 'youverify', 'manual']) {
      const result = validate({ KYC_PROVIDER: provider });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('KYC_PROVIDER must be');
    }
  });
});
