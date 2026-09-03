import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Youverify production configuration', () => {
  const script = resolve(
    __dirname,
    '../../scripts/validate-production-config.sh',
  );
  const productionEnv = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL:
      'postgresql://postgres.project-ref:test-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require&schema=public',
    WEB_URL: 'https://trustpay.example.com',
    ADMIN_URL: 'https://admin.trustpay.example.com',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
    REDIS_URL: 'rediss://default:test@redis.example.com:6379',
    REDIS_ALLOW_MEMORY_FALLBACK: 'false',
    TRUST_PROXY_HOPS: '1',
    IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID: 'v1',
    INTERNAL_TRANSFERS_ENABLED: 'false',
    TRANSACTION_PIN_REQUIRED: 'true',
    BANKING_ENABLED: 'false',
    VIRTUAL_ACCOUNTS_ENABLED: 'false',
    WITHDRAWALS_ENABLED: 'false',
    KYC_PROVIDER: 'youverify',
    YOUVERIFY_API_KEY: 'test-youverify-api-key',
    YOUVERIFY_BASE_URL: 'https://api.youverify.co',
    YOUVERIFY_WEBHOOK_URL:
      'https://api.trustpay.example.com/api/webhooks/kyc/youverify',
    YOUVERIFY_WEBHOOK_SECRET: 'test-youverify-webhook-secret',
    PII_ENCRYPTION_KEY: 'test-pii-key-with-at-least-32-characters',
    VTU_ENABLED: 'false',
    VTU_PROVIDER: 'vtpass',
    VTPASS_BASE_URL: 'https://vtpass.com/api',
    VTPASS_API_KEY: 'test-vtpass-api-key',
    VTPASS_PUBLIC_KEY: 'test-vtpass-public-key',
    VTPASS_SECRET_KEY: 'test-vtpass-secret-key',
    VTPASS_WEBHOOK_SECRET: 'test-vtpass-webhook-secret',
  };

  const validate = (overrides: Record<string, string | undefined> = {}) => {
    const env = { ...productionEnv, ...overrides };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete env[key];
    }
    return spawnSync(script, ['true'], { env, encoding: 'utf8' });
  };

  it('accepts the canonical live Youverify configuration', () => {
    const result = validate();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.each([
    'YOUVERIFY_API_KEY',
    'YOUVERIFY_BASE_URL',
    'YOUVERIFY_WEBHOOK_URL',
    'YOUVERIFY_WEBHOOK_SECRET',
  ])('rejects a missing %s', (key) => {
    const result = validate({ [key]: undefined });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${key} is required`);
  });

  it('rejects the Youverify sandbox endpoint in production', () => {
    const result = validate({
      YOUVERIFY_BASE_URL: 'https://api.sandbox.youverify.co',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'YOUVERIFY_BASE_URL points at a sandbox, localhost, or known bad host',
    );
  });

  it('rejects unsupported KYC providers', () => {
    const result = validate({ KYC_PROVIDER: 'manual' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('KYC_PROVIDER must be ninja or youverify');
  });

  it.each(['YOUVERIFY_API_KEY', 'YOUVERIFY_WEBHOOK_SECRET'])(
    'rejects an unsafe short %s',
    (key) => {
      const result = validate({ [key]: 'short' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${key} must be at least 16 characters`);
    },
  );

  it('requires the PII encryption key used for stored identity numbers', () => {
    const result = validate({ PII_ENCRYPTION_KEY: undefined });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PII_ENCRYPTION_KEY is required');
  });
});
