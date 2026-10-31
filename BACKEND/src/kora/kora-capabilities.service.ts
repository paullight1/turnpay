import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Joi from 'joi';

const flag = () => Joi.boolean().truthy('true').falsy('false').default(false);
export const koraConfigurationFields = {
  PAYSTACK_EXCHANGE_USE_CASE_APPROVED: flag(),
  KORA_GHS_DAILY_LIMIT: Joi.string()
    .pattern(/^\d+(\.\d{1,2})?$/)
    .default('0'),
  KORA_GHS_MONTHLY_LIMIT: Joi.string()
    .pattern(/^\d+(\.\d{1,2})?$/)
    .default('0'),
  KORA_GHS_PAYOUT_FEE_BUFFER: Joi.string()
    .pattern(/^\d+(\.\d{1,2})?$/)
    .default('0'),
  KORA_REDIRECT_HOSTS: Joi.string().max(1000).allow('').default(''),
  KORA_GHS_ENABLED: flag(),
  KORA_GHS_VIRTUAL_ACCOUNTS_ENABLED: flag(),
  KORA_GHS_MOMO_COLLECTIONS_ENABLED: flag(),
  KORA_GHS_MOMO_PAYOUTS_ENABLED: flag(),
  KORA_EXCHANGE_USE_CASE_APPROVED: flag(),
  KORA_SECRET_KEY: Joi.when('KORA_GHS_ENABLED', {
    is: true,
    then: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .trim()
        .pattern(/^sk_live_[A-Za-z0-9_-]+$/)
        .required(),
      otherwise: Joi.string()
        .trim()
        .pattern(/^sk_(test|live)_[A-Za-z0-9_-]+$/)
        .required(),
    }),
    otherwise: Joi.string().allow('').optional(),
  }),
};
export const koraConfigurationSchema = Joi.object({
  NODE_ENV: Joi.string(),
  ...koraConfigurationFields,
});

@Injectable()
export class KoraCapabilitiesService {
  constructor(private readonly config: ConfigService) {}
  get() {
    const flagOn = (name: string) => {
      const value = this.config.get<unknown>(name);
      return value === true || value === 'true';
    };
    const secret = this.config.get<string>('KORA_SECRET_KEY', '').trim();
    const configured =
      /^sk_(test|live)_[A-Za-z0-9_-]+$/.test(secret) &&
      (this.config.get('NODE_ENV') !== 'production' ||
        secret.startsWith('sk_live_'));
    const enabled = configured && flagOn('KORA_GHS_ENABLED');
    const useCaseApproved = flagOn('KORA_EXCHANGE_USE_CASE_APPROVED');
    return {
      provider: 'kora' as const,
      currency: 'GHS' as const,
      configured,
      enabled,
      activationStatus: 'UNCONFIRMED' as const,
      useCaseApproved,
      exchange: enabled && useCaseApproved,
      virtualAccounts: enabled && flagOn('KORA_GHS_VIRTUAL_ACCOUNTS_ENABLED'),
      momoCollections: enabled && flagOn('KORA_GHS_MOMO_COLLECTIONS_ENABLED'),
      momoPayouts: enabled && flagOn('KORA_GHS_MOMO_PAYOUTS_ENABLED'),
      bankPayouts: false,
    };
  }
}
