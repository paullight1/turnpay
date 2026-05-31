import {
  KYCType,
  KycVerificationProvider,
  KycVerificationStatus,
  Prisma,
} from "@prisma/client";

export const KYC_PROVIDER_GATEWAY = Symbol("KYC_PROVIDER_GATEWAY");

export type KycProviderSubmission = {
  userId: string;
  documentId: string;
  type: KYCType;
  identifierMasked: string;
};

export type KycProviderResult = {
  provider: KycVerificationProvider;
  status: KycVerificationStatus;
  reference: string;
  checks: Prisma.InputJsonObject;
  responseHash: string;
  errorMessage?: string;
};

export interface KycProviderGateway {
  submitVerification(
    submission: KycProviderSubmission,
  ): Promise<KycProviderResult>;
}
