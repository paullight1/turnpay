import {
  KYCType,
  KycVerificationProvider,
  KycVerificationStatus,
  Prisma,
} from '@prisma/client';

export const KYC_PROVIDER_GATEWAY = Symbol('KYC_PROVIDER_GATEWAY');

export type KycProviderSubmission = {
  userId: string;
  documentId: string;
  type: KYCType;
  identifierMasked: string;
};

export type KycHostedSessionRequest = {
  userId: string;
  documentId: string;
  reference: string;
  type: KYCType;
  country: 'NG' | 'GH';
  callbackUrl: string;
};

export type KycProviderResult = {
  provider: KycVerificationProvider;
  status: KycVerificationStatus;
  reference: string;
  checks: Prisma.InputJsonObject;
  responseHash: string;
  errorMessage?: string;
};

export type KycHostedSessionResult = KycProviderResult & {
  token?: string;
  product: string;
  environment: 'sandbox' | 'production';
  expiresInSeconds?: number;
};

export type KycProviderCallbackResult = KycProviderResult & {
  userId?: string;
  documentType?: KYCType;
  country?: string;
};

export interface KycProviderGateway {
  submitVerification(
    submission: KycProviderSubmission,
  ): Promise<KycProviderResult>;

  createHostedSession(
    request: KycHostedSessionRequest,
  ): Promise<KycHostedSessionResult>;

  verifyCallbackSignature(input: {
    timestamp?: string | number;
    signature?: string;
  }): boolean;

  normalizeCallback(
    payload: Record<string, unknown>,
  ): KycProviderCallbackResult;
}
