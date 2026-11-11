import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('internal transfer production configuration', () => {
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
    TRANSACTION_PIN_REQUIRED: 'true',
    INTERNAL_TRANSFERS_ENABLED: 'false',
    BANKING_ENABLED: 'false',
    BANKING_SANDBOX_MODE: 'false',
    BANKING_PROVIDER_PRIMARY: 'monnify',
    PAYSTACK_CHECKOUT_ENABLED: 'false',
    VIRTUAL_ACCOUNTS_ENABLED: 'false',
    WITHDRAWALS_ENABLED: 'false',
    KYC_PROVIDER: 'monnify',
    MONNIFY_API_KEY: 'test-monnify-api-key',
    MONNIFY_SECRET_KEY: 'test-monnify-secret-key',
    MONNIFY_BASE_URL: 'https://api.monnify.com',
    PII_ENCRYPTION_KEY: 'test-pii-key-with-at-least-32-characters',
    VTU_ENABLED: 'true',
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

  it('allows email OTP without Sentry or Twilio and rejects development OTP overrides', () => {
    const missingSentryEnv = { ...productionEnv };
    delete missingSentryEnv.SENTRY_DSN;
    delete missingSentryEnv.TWILIO_ACCOUNT_SID;
    delete missingSentryEnv.TWILIO_AUTH_TOKEN;
    delete missingSentryEnv.TWILIO_PHONE_NUMBER;
    missingSentryEnv.OTP_PROVIDER = 'supabase_email';
    delete missingSentryEnv.SMS_PROVIDER;
    const missingSentryResult = spawnSync(script, ['true'], {
      env: missingSentryEnv,
      encoding: 'utf8',
    });
    expect(missingSentryResult.status).toBe(0);
    expect(missingSentryResult.stderr).toBe('');

    const devCodeResult = spawnSync(script, ['true'], {
      env: { ...productionEnv, OTP_DEV_CODE: '123456' },
      encoding: 'utf8',
    });
    expect(devCodeResult.status).toBe(1);
    expect(devCodeResult.stderr).toContain(
      'OTP_DEV_CODE must be empty in deployed environments',
    );
  });
  it.each(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'])(
    'rejects missing email auth prerequisite %s',
    (key) => {
      const env: NodeJS.ProcessEnv = {
        ...productionEnv,
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
        SUPABASE_ANON_KEY: '',
      };
      delete env[key];
      const result = spawnSync(script, ['true'], { env, encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        key === 'SUPABASE_URL'
          ? 'SUPABASE_URL'
          : 'Supabase publishable or anon key',
      );
    },
  );
});
