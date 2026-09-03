import type { KycProviderGateway } from './kyc-provider.gateway';

export function selectKycProvider(
  configuredProvider: string | undefined,
  ninja: KycProviderGateway,
  youverify: KycProviderGateway,
): KycProviderGateway {
  switch (configuredProvider?.trim().toLowerCase()) {
    case 'ninja':
      return ninja;
    case 'youverify':
      return youverify;
    default:
      throw new Error('Unsupported KYC provider');
  }
}
