import { ConfigService } from '@nestjs/config';
import { ManualExchangeService } from './manual-exchange.service';

const ngn = {
  MANUAL_EXCHANGE_COLLECTION_BANK_NAME: 'Synthetic Bank',
  MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NAME: 'Synthetic Merchant',
  MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NUMBER: '0001112223',
  MANUAL_EXCHANGE_COLLECTION_VERSION: 'synthetic-v1',
};
const ghs = {
  MANUAL_EXCHANGE_GHS_COLLECTION_BANK_NAME: 'Synthetic MoMo',
  MANUAL_EXCHANGE_GHS_COLLECTION_ACCOUNT_NAME: 'Synthetic Ghana Merchant',
  MANUAL_EXCHANGE_GHS_COLLECTION_ACCOUNT_NUMBER: '0240000000',
  MANUAL_EXCHANGE_GHS_COLLECTION_VERSION: 'synthetic-v1',
};
function configuration(values: Record<string, unknown>) {
  return new ManualExchangeService(
    {} as never,
    new ConfigService({
      MANUAL_EXCHANGE_ENABLED: false,
      ...Object.fromEntries(
        Object.keys({ ...ngn, ...ghs }).map((key) => [key, '']),
      ),
      ...values,
    }),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ).configuration();
}
describe('manual exchange receiving-account readiness', () => {
  it('offers both configured directions with no product limits or wallet policy configuration', () => {
    expect(
      configuration({ MANUAL_EXCHANGE_ENABLED: true, ...ngn, ...ghs }),
    ).toMatchObject({
      availableSourceCurrencies: ['GHS', 'NGN'],
      deliveryPolicyVersion: 2,
      settlementOptions: { GHS: ['BANK'] },
      exchangeLimitPolicy: 'UNLIMITED',
      reviewRemindersEnabled: true,
    });
  });
  it('offers only the direction with complete receiving details without exposing account data', () => {
    const result = configuration({ MANUAL_EXCHANGE_ENABLED: true, ...ngn });
    expect(result).toMatchObject({
      enabled: true,
      availableSourceCurrencies: ['NGN'],
    });
    expect(JSON.stringify(result)).not.toContain('0001112223');
    expect(JSON.stringify(result)).not.toContain('Synthetic Merchant');
  });
  it('does not advertise an enabled exchange when receiving details are absent or invalid', () => {
    for (const values of [
      {},
      { ...ngn, MANUAL_EXCHANGE_COLLECTION_ACCOUNT_NUMBER: 'invalid' },
    ]) {
      expect(
        configuration({ MANUAL_EXCHANGE_ENABLED: true, ...values }),
      ).toMatchObject({ enabled: false, availableSourceCurrencies: [] });
    }
  });
  it('keeps both directions available when configured, and respects an explicit pause', () => {
    expect(
      configuration({ MANUAL_EXCHANGE_ENABLED: true, ...ngn, ...ghs }),
    ).toMatchObject({
      enabled: true,
      availableSourceCurrencies: ['GHS', 'NGN'],
    });
    expect(
      configuration({ MANUAL_EXCHANGE_ENABLED: false, ...ngn, ...ghs }),
    ).toMatchObject({ enabled: false, availableSourceCurrencies: [] });
  });
});
