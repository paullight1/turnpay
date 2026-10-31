import { ConfigService } from '@nestjs/config';
import {
  KoraCapabilitiesService,
  koraConfigurationSchema,
} from './kora-capabilities.service';

describe('Kora Ghana capabilities', () => {
  const capabilities = (config: Record<string, unknown>) =>
    new KoraCapabilitiesService(new ConfigService(config)).get();
  it('keeps Ghana disabled by default and never infers access from a MoMo wallet', () => {
    expect(capabilities({})).toMatchObject({
      enabled: false,
      virtualAccounts: false,
      momoCollections: false,
      momoPayouts: false,
      configured: false,
    });
    expect(
      capabilities({
        KORA_SECRET_KEY: 'sk_test_synthetic',
        KORA_GHS_ENABLED: true,
      }).momoPayouts,
    ).toBe(false);
  });
  it('enables only separately approved Ghana capabilities', () => {
    expect(
      capabilities({
        KORA_SECRET_KEY: 'sk_test_synthetic',
        KORA_GHS_ENABLED: true,
        KORA_GHS_MOMO_PAYOUTS_ENABLED: true,
        KORA_EXCHANGE_USE_CASE_APPROVED: true,
      }),
    ).toMatchObject({
      enabled: true,
      configured: true,
      momoPayouts: true,
      virtualAccounts: false,
      exchange: true,
    });
  });
  it('rejects enabled production capabilities without a live key', () => {
    for (const key of ['', 'sk_test_synthetic']) {
      expect(
        koraConfigurationSchema.validate({
          NODE_ENV: 'production',
          KORA_GHS_ENABLED: true,
          KORA_SECRET_KEY: key,
        }).error,
      ).toBeDefined();
    }
    expect(
      koraConfigurationSchema.validate({ NODE_ENV: 'production' }).error,
    ).toBeUndefined();
  });
  it('does not treat string false as enabled', () => {
    expect(
      capabilities({
        KORA_SECRET_KEY: 'sk_test_synthetic',
        KORA_GHS_ENABLED: 'false',
        KORA_GHS_VIRTUAL_ACCOUNTS_ENABLED: 'true',
      }).virtualAccounts,
    ).toBe(false);
  });
});
