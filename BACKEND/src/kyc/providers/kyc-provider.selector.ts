import type { KycProviderGateway } from './kyc-provider.gateway';

export function selectKycProvider(
  configuredProvider: string | undefined,
  monnify: KycProviderGateway,
  _legacy?: KycProviderGateway,
): KycProviderGateway {
  void _legacy;
  switch (configuredProvider?.trim().toLowerCase()) {
    case 'monnify':
      return monnify;
    default:
      throw new Error('KYC_PROVIDER must be monnify');
  }
}
