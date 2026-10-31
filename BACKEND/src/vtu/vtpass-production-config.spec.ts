import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('VTpass production configuration', () => {
  const script = resolve(
    __dirname,
    '../../scripts/validate-production-config.sh',
  );
  const productionEnv = {
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
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    TWILIO_AUTH_TOKEN: 'ci-twilio-auth-token',
    TWILIO_PHONE_NUMBER: '+15557122661',
    IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID: 'v1',
    INTERNAL_TRANSFERS_ENABLED: 'false',
    TRANSACTION_PIN_REQUIRED: 'true',
    BANKING_ENABLED: 'false',
    BANKING_PROVIDER_PRIMARY: 'monnify',
    PAYSTACK_CHECKOUT_ENABLED: 'false',
    VIRTUAL_ACCOUNTS_ENABLED: 'false',
    WITHDRAWALS_ENABLED: 'false',
    KYC_PROVIDER: 'monnify',
    MONNIFY_API_KEY: 'test-monnify-api-key',
    MONNIFY_SECRET_KEY: 'test-monnify-secret-key',
    MONNIFY_BASE_URL: 'https://api.monnify.example.com',
    PII_ENCRYPTION_KEY: 'test-pii-key-with-at-least-32-characters',
    VTU_ENABLED: 'true',
    VTU_SIMULATION_ENABLED: 'false',
    VTU_PROVIDER: 'vtpass',
    VTPASS_BASE_URL: 'https://vtpass.com/api',
    VTPASS_API_KEY: 'test-vtpass-api-key',
    VTPASS_PUBLIC_KEY: 'test-vtpass-public-key',
    VTPASS_SECRET_KEY: 'test-vtpass-secret-key',
    VTPASS_WEBHOOK_SECRET: 'test-vtpass-webhook-secret',
    VTPASS_LOW_BALANCE_THRESHOLD: '5000',
  };

  const validate = (overrides: Record<string, string | undefined> = {}) => {
    const env = { ...productionEnv, ...overrides };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete env[key];
    }
    return spawnSync(script, ['true'], { env, encoding: 'utf8' });
  };

  it('accepts the canonical live VTpass configuration', () => {
    expect(validate().status).toBe(0);
  });

  it.each([
    'VTPASS_BASE_URL',
    'VTPASS_API_KEY',
    'VTPASS_PUBLIC_KEY',
    'VTPASS_SECRET_KEY',
    'VTPASS_WEBHOOK_SECRET',
  ])('rejects a missing %s while VTU is enabled', (key) => {
    const result = validate({ [key]: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${key} is required`);
  });

  it('rejects the obsolete api-service VTpass host', () => {
    const result = validate({
      VTPASS_BASE_URL: 'https://api-service.vtpass.com',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'VTPASS_BASE_URL must be https://vtpass.com/api',
    );
  });

  it('rejects simulation in production', () => {
    const result = validate({ VTU_SIMULATION_ENABLED: 'true' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'VTU_SIMULATION_ENABLED must be false in production',
    );
  });

  it('allows provider credentials to be absent when VTU is disabled', () => {
    expect(
      validate({
        VTU_ENABLED: 'false',
        VTPASS_BASE_URL: undefined,
        VTPASS_API_KEY: undefined,
        VTPASS_PUBLIC_KEY: undefined,
        VTPASS_SECRET_KEY: undefined,
        VTPASS_WEBHOOK_SECRET: undefined,
      }).status,
    ).toBe(0);
  });
});
