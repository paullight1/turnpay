import { BadRequestException } from '@nestjs/common';
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
    bankCode?: string;
    accountNumber?: string;
    accountSetupConsent?: boolean;
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

/**
 * A provider has definitively rejected the submitted identity details.
 *
 * The KYC service uses this marker to close the canonical pending attempt.
 * Other provider errors (timeouts, authorization failures, rate limits, or
 * unknown responses) intentionally remain pending because the provider may
 * have accepted the request before the error reached us.
 */
export class KycProviderDefinitiveFailure extends BadRequestException {
  constructor(
    readonly provider: KycVerificationProvider,
    message: string,
    readonly validationFingerprint?: string,
  ) {
    super(message);
  }
}

export interface KycProviderGateway {
  readonly provider: KycVerificationProvider;

  verifyIdentity(
    request: KycIdentityVerificationRequest,
  ): Promise<KycProviderResult>;
}
