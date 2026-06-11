import { Injectable } from '@nestjs/common';
import {
  KYCType,
  KycVerificationProvider,
  KycVerificationStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import {
  KycHostedSessionRequest,
  KycHostedSessionResult,
  KycProviderCallbackResult,
  KycProviderGateway,
  KycProviderResult,
  KycProviderSubmission,
} from './kyc-provider.gateway';

@Injectable()
export class ManualKycProvider implements KycProviderGateway {
  submitVerification(
    submission: KycProviderSubmission,
  ): Promise<KycProviderResult> {
    const checks: Prisma.InputJsonObject = {
      documentType: submission.type,
      identifierMasked: submission.identifierMasked,
      manualReviewRequired: true,
      reason: 'EXTERNAL_PROVIDER_NOT_CONFIGURED',
    };
    const result = {
      provider: KycVerificationProvider.MANUAL_REVIEW,
      status: KycVerificationStatus.REVIEW_REQUIRED,
      reference: `manual-${submission.documentId}`,
      checks,
    };

    return Promise.resolve({
      ...result,
      responseHash: createHash('sha256')
        .update(JSON.stringify(result))
        .digest('hex'),
    });
  }

  createHostedSession(
    request: KycHostedSessionRequest,
  ): Promise<KycHostedSessionResult> {
    const checks: Prisma.InputJsonObject = {
      country: request.country,
      documentType: request.type,
      manualReviewRequired: true,
      reason: 'SMILE_ID_PROVIDER_NOT_CONFIGURED',
    };
    const result = {
      provider: KycVerificationProvider.MANUAL_REVIEW,
      status: KycVerificationStatus.REVIEW_REQUIRED,
      reference: `manual-${request.reference}`,
      checks,
      product: 'manual_review',
      environment: 'sandbox' as const,
    };

    return Promise.resolve({
      ...result,
      responseHash: createHash('sha256')
        .update(JSON.stringify(result))
        .digest('hex'),
    });
  }

  verifyCallbackSignature(): boolean {
    return false;
  }

  normalizeCallback(
    payload: Record<string, unknown>,
  ): KycProviderCallbackResult {
    const reference =
      this.asString(payload.job_id) ||
      this.asString(payload.SmileJobID) ||
      'manual-callback';
    const checks: Prisma.InputJsonObject = {
      manualReviewRequired: true,
      reason: 'MANUAL_PROVIDER_DOES_NOT_ACCEPT_CALLBACKS',
    };
    const result = {
      provider: KycVerificationProvider.MANUAL_REVIEW,
      status: KycVerificationStatus.REVIEW_REQUIRED,
      reference,
      checks,
      documentType: undefined as KYCType | undefined,
    };

    return {
      ...result,
      responseHash: createHash('sha256')
        .update(JSON.stringify(result))
        .digest('hex'),
    };
  }

  private asString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }
}
