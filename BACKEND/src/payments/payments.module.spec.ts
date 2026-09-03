import { MODULE_METADATA } from '@nestjs/common/constants';
import { PaymentsModule } from './payments.module';

describe('PaymentsModule provider policy', () => {
  it('does not bootstrap retired payment gateways that require unused secrets', () => {
    const providers =
      (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentsModule) as
        | Array<{ name?: string }>
        | undefined) ?? [];
    const providerNames = providers.map((provider) => provider.name);

    expect(providerNames).not.toContain('PaystackProvider');
    expect(providerNames).not.toContain('FlutterwaveProvider');
  });
});
