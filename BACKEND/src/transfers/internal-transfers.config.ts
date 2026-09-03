import * as Joi from 'joi';

const booleanFlag = Joi.boolean().truthy('true').falsy('false');

export const internalTransfersEnabledSchema = Joi.when('NODE_ENV', {
  is: 'production',
  then: booleanFlag.required(),
  otherwise: booleanFlag.default(false),
});
