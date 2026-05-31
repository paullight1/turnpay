import { Injectable } from "@nestjs/common";
import {
  KycVerificationProvider,
  KycVerificationStatus,
  Prisma,
} from "@prisma/client";
import { createHash } from "crypto";
import {
  KycProviderGateway,
  KycProviderResult,
  KycProviderSubmission,
} from "./kyc-provider.gateway";

@Injectable()
export class ManualKycProvider implements KycProviderGateway {
  submitVerification(
    submission: KycProviderSubmission,
  ): Promise<KycProviderResult> {
    const checks: Prisma.InputJsonObject = {
      documentType: submission.type,
      identifierMasked: submission.identifierMasked,
      manualReviewRequired: true,
      reason: "EXTERNAL_PROVIDER_NOT_CONFIGURED",
    };
    const result = {
      provider: KycVerificationProvider.MANUAL_REVIEW,
      status: KycVerificationStatus.REVIEW_REQUIRED,
      reference: `manual-${submission.documentId}`,
      checks,
    };

    return Promise.resolve({
      ...result,
      responseHash: createHash("sha256")
        .update(JSON.stringify(result))
        .digest("hex"),
    });
  }
}
