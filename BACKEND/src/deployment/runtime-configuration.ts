import * as Joi from 'joi';

const booleanFlag = Joi.boolean().truthy('true').falsy('false');

const explicitFinancialFlag = () =>
  Joi.when('NODE_ENV', {
    is: 'production',
    then: booleanFlag.required(),
    otherwise: booleanFlag.default(true),
  });

export const financialConfigurationFields = {
  BANKING_ENABLED: explicitFinancialFlag(),
  VIRTUAL_ACCOUNTS_ENABLED: explicitFinancialFlag(),
  WITHDRAWALS_ENABLED: explicitFinancialFlag(),
  PAYSTACK_TRANSFER_APPROVAL_ENABLED: booleanFlag.default(false),
  PAYSTACK_CHECKOUT_ENABLED: explicitFinancialFlag(),
  VTU_ENABLED: explicitFinancialFlag(),
  BANKING_SANDBOX_MODE: Joi.when('NODE_ENV', {
    is: 'production',
    then: booleanFlag.valid(false).required(),
    otherwise: booleanFlag.default(true),
  }),
};

export function runtimeConfigurationFiles(environment: string) {
  if (!['development', 'test', 'staging', 'production'].includes(environment)) {
    throw new Error(
      'NODE_ENV must be development, test, staging, or production',
    );
  }
  return environment === 'development' || environment === 'test'
    ? { envFilePath: ['.env', '.env.example'] }
    : { ignoreEnvFile: true };
}
