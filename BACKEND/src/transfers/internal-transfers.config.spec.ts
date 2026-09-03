import * as Joi from 'joi';
import { internalTransfersEnabledSchema } from './internal-transfers.config';

describe('internal transfer environment schema', () => {
  const schema = Joi.object({
    NODE_ENV: Joi.string().required(),
    INTERNAL_TRANSFERS_ENABLED: internalTransfersEnabledSchema,
  });

  it('requires an explicit flag in production', () => {
    const result = schema.validate({ NODE_ENV: 'production' });

    expect(result.error?.message).toContain(
      '"INTERNAL_TRANSFERS_ENABLED" is required',
    );
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('normalizes production value %s to %p', (input, expected) => {
    const result = schema.validate({
      NODE_ENV: 'production',
      INTERNAL_TRANSFERS_ENABLED: input,
    });

    expect(result.error).toBeUndefined();
    expect(result.value.INTERNAL_TRANSFERS_ENABLED).toBe(expected);
  });

  it('defaults to disabled outside production', () => {
    const result = schema.validate({ NODE_ENV: 'development' });

    expect(result.error).toBeUndefined();
    expect(result.value.INTERNAL_TRANSFERS_ENABLED).toBe(false);
  });

  it('rejects non-boolean flag values', () => {
    const result = schema.validate({
      NODE_ENV: 'production',
      INTERNAL_TRANSFERS_ENABLED: 'yes',
    });

    expect(result.error?.message).toContain(
      '"INTERNAL_TRANSFERS_ENABLED" must be a boolean',
    );
  });
});
