import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KYCType,
  KycVerificationProvider,
  KycVerificationStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { Signature, WebApi } from 'smile-identity-core';
import {
  KycHostedSessionRequest,
  KycHostedSessionResult,
  KycProviderCallbackResult,
  KycProviderGateway,
  KycProviderResult,
  KycProviderSubmission,
} from './kyc-provider.gateway';

const DEFAULT_SMILE_PRODUCT = 'biometric_kyc';
const DEFAULT_TOKEN_TTL_SECONDS = 15 * 60;

@Injectable()
export class SmileIdProvider implements KycProviderGateway {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {}

  submitVerification(
    submission: KycProviderSubmission,
  ): Promise<KycProviderResult> {
    const checks: Prisma.InputJsonObject = {
      documentType: submission.type,
      identifierMasked: submission.identifierMasked,
      manualReviewRequired: true,
      reason: 'USE_HOSTED_SMILE_ID_SESSION',
    };
    const result = {
      provider: KycVerificationProvider.SMILE_ID,
      status: KycVerificationStatus.REVIEW_REQUIRED,
      reference: `smile-manual-${submission.documentId}`,
      checks,
    };

    return Promise.resolve({
      ...result,
      responseHash: this.hash(result),
    });
  }

  async createHostedSession(
    request: KycHostedSessionRequest,
  ): Promise<KycHostedSessionResult> {
    const connection = this.createWebApiConnection(request.callbackUrl);
    const product = this.getProduct();

    const tokenResult = await connection.get_web_token({
      user_id: request.userId,
      job_id: request.reference,
      product,
      callback_url: request.callbackUrl,
    });

    const checks: Prisma.InputJsonObject = {
      country: request.country,
      documentType: request.type,
      product,
      hostedCapture: true,
      tokenIssued: Boolean(tokenResult.token),
    };
    const result = {
      provider: KycVerificationProvider.SMILE_ID,
      status: KycVerificationStatus.PENDING,
      reference: request.reference,
      checks,
      product,
      environment: this.getEnvironment(),
      expiresInSeconds: DEFAULT_TOKEN_TTL_SECONDS,
    };

    this.logger.info(
      {
        userId: request.userId,
        jobId: request.reference,
        country: request.country,
        documentType: request.type,
        product,
      },
      'Smile ID hosted KYC session created',
    );

    return {
      ...result,
      token: tokenResult.token,
      responseHash: this.hash(result),
    };
  }

  verifyCallbackSignature(input: {
    timestamp?: string | number;
    signature?: string;
  }): boolean {
    if (!input.timestamp || !input.signature) {
      return false;
    }

    return new Signature(
      this.getRequiredConfig('SMILE_ID_PARTNER_ID'),
      this.getRequiredConfig('SMILE_ID_API_KEY'),
    ).confirm_signature(input.timestamp, input.signature);
  }

  normalizeCallback(
    payload: Record<string, unknown>,
  ): KycProviderCallbackResult {
    const resultPayload = this.asRecord(payload.result) ?? payload;
    const partnerParams = this.asRecord(
      resultPayload.PartnerParams ?? resultPayload.partner_params,
    );
    const reference =
      this.asString(partnerParams?.job_id) ||
      this.asString(resultPayload.job_id) ||
      this.asString(payload.job_id) ||
      this.asString(resultPayload.JobID) ||
      this.asString(resultPayload.SmileJobID);

    if (!reference) {
      throw new BadRequestException(
        'Smile ID callback is missing job reference',
      );
    }

    const resultText = this.asString(resultPayload.ResultText);
    const resultCode = this.asString(resultPayload.ResultCode);
    const actions = this.asRecord(resultPayload.Actions);
    const documentType = this.mapDocumentType(
      this.asString(resultPayload.IDType) ||
        this.asString(resultPayload.id_type) ||
        this.asString(partnerParams?.id_type),
    );
    const country =
      this.asString(resultPayload.Country) ||
      this.asString(resultPayload.country) ||
      this.asString(partnerParams?.country);
    const status = this.normalizeStatus(resultText, actions);
    const checks: Prisma.InputJsonObject = {
      resultCode,
      resultText,
      smileJobId: this.asString(resultPayload.SmileJobID),
      actions: this.redactActions(actions) as
        | Prisma.InputJsonObject
        | undefined,
      country,
      idType: this.asString(resultPayload.IDType),
      reviewRequired: status === KycVerificationStatus.REVIEW_REQUIRED,
      receivedAt: new Date().toISOString(),
    };
    const result = {
      provider: KycVerificationProvider.SMILE_ID,
      status,
      reference,
      checks,
      userId:
        this.asString(partnerParams?.user_id) ||
        this.asString(resultPayload.user_id) ||
        this.asString(payload.user_id),
      documentType,
      country,
      errorMessage:
        status === KycVerificationStatus.REJECTED ||
        status === KycVerificationStatus.FAILED
          ? resultText || 'Smile ID verification did not pass'
          : undefined,
    };

    return {
      ...result,
      responseHash: this.hash(result),
    };
  }

  private createWebApiConnection(callbackUrl: string) {
    return new WebApi(
      this.getRequiredConfig('SMILE_ID_PARTNER_ID'),
      callbackUrl,
      this.getRequiredConfig('SMILE_ID_API_KEY'),
      this.getServer(),
    );
  }

  private getRequiredConfig(key: string) {
    const value = this.configService.get<string>(key);
    if (!value?.trim()) {
      throw new BadRequestException(`${key} is not configured`);
    }
    return value.trim();
  }

  private getProduct() {
    return (
      this.configService.get<string>('SMILE_ID_PRODUCT') ||
      DEFAULT_SMILE_PRODUCT
    );
  }

  private getServer() {
    const configured = this.configService.get<string>('SMILE_ID_SERVER') || '0';
    if (configured === 'production') return '1';
    if (configured === 'sandbox') return '0';
    return configured;
  }

  private getEnvironment(): 'sandbox' | 'production' {
    return this.getServer() === '1' ? 'production' : 'sandbox';
  }

  private normalizeStatus(
    resultText: string | undefined,
    actions: Record<string, unknown> | undefined,
  ) {
    const actionValues = Object.values(actions ?? {})
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());
    const text = resultText?.toLowerCase() ?? '';

    if (
      actionValues.some((value) => value.includes('under review')) ||
      text.includes('under review')
    ) {
      return KycVerificationStatus.REVIEW_REQUIRED;
    }

    if (
      actionValues.some((value) =>
        ['failed', 'not verified', 'not done', 'unable to determine'].some(
          (needle) => value.includes(needle),
        ),
      ) ||
      ['fail', 'failed', 'no match', 'rejected', 'error'].some((needle) =>
        text.includes(needle),
      )
    ) {
      return text.includes('system') || text.includes('issuer unavailable')
        ? KycVerificationStatus.FAILED
        : KycVerificationStatus.REJECTED;
    }

    if (
      actionValues.length > 0 &&
      actionValues.every((value) =>
        ['passed', 'verified', 'approved', 'matched', 'not applicable'].some(
          (needle) => value.includes(needle),
        ),
      )
    ) {
      return KycVerificationStatus.VERIFIED;
    }

    if (
      ['pass', 'passed', 'verified', 'approved', 'matched'].some((needle) =>
        text.includes(needle),
      )
    ) {
      return KycVerificationStatus.VERIFIED;
    }

    return KycVerificationStatus.REVIEW_REQUIRED;
  }

  private mapDocumentType(value: string | undefined): KYCType | undefined {
    const normalized = value
      ?.trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (!normalized) {
      return undefined;
    }

    if (normalized.includes('BVN')) return 'BVN';
    if (normalized.includes('NIN')) return 'NIN';
    if (normalized.includes('GHANA') || normalized.includes('GHA'))
      return 'GHANA_CARD';
    if (normalized.includes('PASSPORT')) return 'PASSPORT';
    if (normalized.includes('DRIVER')) return 'DRIVERS_LICENSE';
    if (normalized.includes('VOTER')) return 'VOTERS_CARD';

    return undefined;
  }

  private redactActions(actions: Record<string, unknown> | undefined) {
    if (!actions) {
      return undefined;
    }

    return Object.fromEntries(
      Object.entries(actions).filter(
        ([key]) =>
          !['Photo', 'IDNumber', 'FullName', 'PhoneNumber'].includes(key),
      ),
    );
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private asString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
