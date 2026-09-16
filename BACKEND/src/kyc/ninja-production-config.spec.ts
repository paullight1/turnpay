import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Ninja production configuration', () => {
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
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    TWILIO_AUTH_TOKEN: 'ci-twilio-auth-token',
    TWILIO_PHONE_NUMBER: '+15557122661',
    IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID: 'v1',
    INTERNAL_TRANSFERS_ENABLED: 'false',
    TRANSACTION_PIN_REQUIRED: 'true',
    BANKING_ENABLED: 'false',
    VIRTUAL_ACCOUNTS_ENABLED: 'false',
    WITHDRAWALS_ENABLED: 'false',
    KYC_PROVIDER: 'ninja',
    NINJA_CLIENT_KEY: 'test-ninja-client-key',
    NINJA_CLIENT_SECRET: 'test-ninja-client-secret',
    NINJA_BASE_URL: 'https://api.ninja.boucloud.io',
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

  it('accepts the canonical live Ninja configuration without Youverify settings', () => {
    const result = validate({
      YOUVERIFY_API_KEY: undefined,
      YOUVERIFY_BASE_URL: undefined,
      YOUVERIFY_WEBHOOK_URL: undefined,
      YOUVERIFY_WEBHOOK_SECRET: undefined,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.each(['NINJA_CLIENT_KEY', 'NINJA_CLIENT_SECRET', 'NINJA_BASE_URL'])(
    'rejects a missing %s',
    (key) => {
      const result = validate({ [key]: undefined });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${key} is required`);
    },
  );

  it('rejects the Ninja sandbox endpoint in production', () => {
    const result = validate({
      NINJA_BASE_URL: 'https://api.sandbox.ninja.boucloud.io',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'NINJA_BASE_URL points at a sandbox, localhost, or known bad host',
    );
  });

  it('rejects a non-Ninja HTTPS base URL in production', () => {
    const result = validate({
      NINJA_BASE_URL: 'https://identity-attacker.example.com',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'NINJA_BASE_URL must be https://api.ninja.boucloud.io',
    );
  });

  it('rejects unsupported KYC providers', () => {
    const result = validate({ KYC_PROVIDER: 'manual' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('KYC_PROVIDER must be ninja or youverify');
  });
});
