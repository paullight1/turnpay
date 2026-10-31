import type { KycProviderGateway } from './kyc-provider.gateway';

export function selectKycProvider(
  configuredProvider: string | undefined,
  monnify: KycProviderGateway,
  paystack?: KycProviderGateway,
): KycProviderGateway {
  switch (configuredProvider?.trim().toLowerCase()) {
    case 'monnify':
      return monnify;
    case 'paystack':
      if (!paystack) {
        throw new Error('Paystack KYC provider is not configured');
      }
      return paystack;
    default:
      throw new Error('KYC_PROVIDER must be monnify or paystack');
  }
}
