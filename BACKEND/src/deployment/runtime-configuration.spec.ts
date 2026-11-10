import * as Joi from 'joi';
import {
  financialConfigurationFields,
  runtimeConfigurationFiles,
} from './runtime-configuration';

describe('deployed runtime configuration', () => {
  const flags = {
    BANKING_ENABLED: false,
    VIRTUAL_ACCOUNTS_ENABLED: false,
    WITHDRAWALS_ENABLED: false,
    PAYSTACK_CHECKOUT_ENABLED: false,
    VTU_ENABLED: false,
    BANKING_SANDBOX_MODE: false,
  };
  const schema = Joi.object({
    NODE_ENV: Joi.string().required(),
    ...financialConfigurationFields,
  });

  it.each(Object.keys(flags))(
    'rejects an omitted production flag %s',
    (key) => {
      const values: Record<string, unknown> = {
        NODE_ENV: 'production',
        ...flags,
      };
      delete values[key];
      expect(schema.validate(values).error?.message).toContain(
        `"${key}" is required`,
      );
    },
  );

  it('accepts explicit disabled production features and rejects sandbox mode', () => {
    expect(
      schema.validate({ NODE_ENV: 'production', ...flags }).error,
    ).toBeUndefined();
    expect(
      schema.validate({
        NODE_ENV: 'production',
        ...flags,
        BANKING_SANDBOX_MODE: true,
      }).error,
    ).toBeDefined();
  });

  it('retains development defaults', () => {
    const result = schema.validate({ NODE_ENV: 'development' });
    expect(result.error).toBeUndefined();
    expect(result.value.BANKING_ENABLED).toBe(true);
  });

  it.each(['production', 'staging'])(
    'ignores local and example files in %s',
    (mode) => {
      expect(runtimeConfigurationFiles(mode)).toEqual({ ignoreEnvFile: true });
    },
  );

  it.each(['Production', 'PRODUCTION', ' production ', 'staging '])(
    'rejects a noncanonical environment mode %p',
    (mode) => {
      expect(() => runtimeConfigurationFiles(mode)).toThrow(
        'NODE_ENV must be development, test, staging, or production',
      );
    },
  );

  it('keeps local file precedence for development', () => {
    expect(runtimeConfigurationFiles('development')).toEqual({
      envFilePath: ['.env', '.env.example'],
    });
  });
});
