import {
  KYCType,
  KycVerificationProvider,
  KycVerificationStatus,
  Prisma,
} from '@prisma/client';

export const KYC_PROVIDER_GATEWAY = Symbol('KYC_PROVIDER_GATEWAY');

export type KycIdentityVerificationRequest = {
  userId: string;
  documentId: string;
  type: KYCType;
  identifierMasked: string;
  country: 'NG' | 'GH';
  identifier: string;
  consentAccepted: true;
  validation?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    phone?: string;
  };
};

export type KycProviderResult = {
  provider: KycVerificationProvider;
  status: KycVerificationStatus;
  reference: string;
  checks: Prisma.InputJsonObject;
  responseHash: string;
  errorMessage?: string;
};

export type KycProviderCallbackResult = KycProviderResult & {
  userId?: string;
  documentType?: KYCType;
  country?: string;
};

export interface KycProviderGateway {
  readonly provider: KycVerificationProvider;

  verifyIdentity(
    request: KycIdentityVerificationRequest,
  ): Promise<KycProviderResult>;

  verifyCallbackSignature(input: {
    signature?: string;
    rawBody?: Buffer | string;
  }): boolean;

  normalizeCallback(
    payload: Record<string, unknown>,
  ): KycProviderCallbackResult;
}
