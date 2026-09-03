import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('internal transfer production configuration', () => {
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
    TRANSACTION_PIN_REQUIRED: 'true',
    BANKING_ENABLED: 'false',
    VIRTUAL_ACCOUNTS_ENABLED: 'false',
    WITHDRAWALS_ENABLED: 'false',
    KYC_PROVIDER: 'youverify',
    YOUVERIFY_API_KEY: 'test-youverify-api-key',
    YOUVERIFY_BASE_URL: 'https://api.youverify.example.com',
    YOUVERIFY_WEBHOOK_URL:
      'https://api.trustpay.example.com/webhooks/youverify',
    YOUVERIFY_WEBHOOK_SECRET: 'test-youverify-webhook-secret',
    PII_ENCRYPTION_KEY: 'test-pii-key-with-at-least-32-characters',
    VTU_PROVIDER: 'vtpass',
    VTPASS_BASE_URL: 'https://vtpass.com/api',
    VTPASS_API_KEY: 'test-vtpass-api-key',
    VTPASS_PUBLIC_KEY: 'test-vtpass-public-key',
    VTPASS_SECRET_KEY: 'test-vtpass-secret-key',
    VTPASS_WEBHOOK_SECRET: 'test-vtpass-webhook-secret',
  };

  const validate = (value?: string) => {
    const env = { ...productionEnv };
    if (value === undefined) {
      delete env.INTERNAL_TRANSFERS_ENABLED;
    } else {
      env.INTERNAL_TRANSFERS_ENABLED = value;
    }

    return spawnSync(script, ['true'], {
      env,
      encoding: 'utf8',
    });
  };

  it.each([undefined, '', 'yes', '1', 'disabled'])(
    'rejects a missing or non-boolean flag (value: %p)',
    (value) => {
      const result = validate(value);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'INTERNAL_TRANSFERS_ENABLED must be explicitly true or false',
      );
    },
  );

  it.each(['true', 'false', 'TRUE', 'FALSE'])(
    'accepts an explicit boolean flag (value: %s)',
    (value) => {
      const result = validate(value);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    },
  );

  it.each([
    'postgresql://trustpay:test-password@render-postgres.internal:5432/trustpay?sslmode=require',
    'postgresql://trustpay:test-password@db.example.com:5432/trustpay?sslmode=require',
    'postgresql://postgres.project-ref:test-password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require',
  ])('rejects a non-Supabase or transaction-pooler database URL: %s', (url) => {
    const result = spawnSync(script, ['true'], {
      env: {
        ...productionEnv,
        DATABASE_URL: url,
        INTERNAL_TRANSFERS_ENABLED: 'false',
        TRANSACTION_PIN_REQUIRED: 'true',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'DATABASE_URL must use the Supabase direct or session-pooler endpoint on port 5432',
    );
  });

  it('rejects a Supabase database URL without required TLS', () => {
    const result = spawnSync(script, ['true'], {
      env: {
        ...productionEnv,
        DATABASE_URL:
          'postgresql://postgres.project-ref:test-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?schema=public',
        INTERNAL_TRANSFERS_ENABLED: 'false',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL must require TLS');
  });

  it('rejects production memory fallback for distributed controls', () => {
    const result = spawnSync(script, ['true'], {
      env: {
        ...productionEnv,
        INTERNAL_TRANSFERS_ENABLED: 'false',
        REDIS_ALLOW_MEMORY_FALLBACK: 'true',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'REDIS_ALLOW_MEMORY_FALLBACK must be false in production',
    );
  });

  it('rejects an invalid sensitive idempotency encryption key', () => {
    const result = spawnSync(script, ['true'], {
      env: {
        ...productionEnv,
        INTERNAL_TRANSFERS_ENABLED: 'false',
        IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY: 'not-32-bytes',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY must decode to exactly 32 bytes',
    );
  });
});
