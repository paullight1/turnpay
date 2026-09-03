import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import {
  KYCType,
  KycVerificationProvider,
  KycVerificationStatus,
  Prisma,
} from '@prisma/client';
import { isAxiosError } from 'axios';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import { CircuitBreakerService } from '../../common/services/circuit-breaker.service';
import {
  KycIdentityVerificationRequest,
  KycProviderCallbackResult,
  KycProviderGateway,
  KycProviderResult,
} from './kyc-provider.gateway';

type YouverifyResponse = {
  success?: boolean;
  statusCode?: number;
  message?: string;
  data?: Record<string, unknown>;
};

const YOUVERIFY_CIRCUIT = 'youverify';
const DEFAULT_YOUVERIFY_BASE_URL = 'https://api.sandbox.youverify.co';

@Injectable()
export class YouverifyProvider implements KycProviderGateway {
  readonly provider = KycVerificationProvider.YOUVERIFY;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async verifyIdentity(
    request: KycIdentityVerificationRequest,
  ): Promise<KycProviderResult> {
    if (request.consentAccepted !== true) {
      throw new BadRequestException('KYC consent is required');
    }

    const endpoint = this.resolveEndpoint(request.country, request.type);
    if (!(await this.circuitBreaker.canExecute(YOUVERIFY_CIRCUIT))) {
      throw new ServiceUnavailableException(
        'Identity verification is temporarily unavailable',
      );
    }

    const validationData = this.compactValidation(request.validation);
    const payload: Record<string, unknown> = {
      id: request.identifier,
      isSubjectConsent: true,
      metadata: { requestId: request.documentId },
    };
    if (validationData) {
      payload.validations = { data: validationData };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<YouverifyResponse>(
          `${this.baseUrl}${endpoint}`,
          payload,
          {
            headers: {
              token: this.getRequiredConfig('YOUVERIFY_API_KEY'),
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      const result = this.normalizeIdentityResult(response.data, {
        country: request.country,
        type: request.type,
        identifierMasked: request.identifierMasked,
      });

      await this.circuitBreaker.recordSuccess(YOUVERIFY_CIRCUIT);
      this.logger.info(
        {
          reference: result.reference,
          country: request.country,
          documentType: request.type,
          status: result.status,
        },
        'Youverify identity verification completed',
      );
      return result;
    } catch (error) {
      await this.circuitBreaker.recordFailure(YOUVERIFY_CIRCUIT);
      if (error instanceof BadRequestException) throw error;

      const statusCode = isAxiosError(error) ? error.response?.status : null;
      this.logger.warn(
        {
          country: request.country,
          documentType: request.type,
          upstreamStatusCode: statusCode,
        },
        'Youverify identity verification failed',
      );
      throw new ServiceUnavailableException(
        'Identity verification could not be completed',
      );
    }
  }

  verifyCallbackSignature(input: {
    rawBody?: Buffer | string;
    signature?: string;
  }): boolean {
    if (!input.rawBody || !input.signature) return false;

    const secret = this.configService.get<string>('YOUVERIFY_WEBHOOK_SECRET');
    if (!secret?.trim()) return false;

    const supplied = input.signature.trim().replace(/^sha256=/i, '');
    const expectedHex = createHmac('sha256', secret.trim())
      .update(input.rawBody)
      .digest('hex');
    const expectedBase64 = createHmac('sha256', secret.trim())
      .update(input.rawBody)
      .digest('base64');

    return (
      this.safeEqual(supplied.toLowerCase(), expectedHex) ||
      this.safeEqual(supplied, expectedBase64)
    );
  }

  normalizeCallback(
    payload: Record<string, unknown>,
  ): KycProviderCallbackResult {
    const data = this.asRecord(payload.data);
    if (!data) {
      throw new BadRequestException('Youverify webhook data is required');
    }

    const reference = this.asString(data.id);
    if (!reference) {
      throw new BadRequestException(
        'Youverify webhook verification reference is required',
      );
    }

    const providerStatus = this.asString(data.status)?.toLowerCase();
    const allValidationPassed = this.asBoolean(data.allValidationPassed);
    const dataValidation = this.asBoolean(data.dataValidation);
    const status = this.normalizeStatus(providerStatus, allValidationPassed);
    const event = this.asString(payload.event);
    const apiVersion = this.asString(payload.apiVersion);
    const checks = this.buildChecks({
      providerStatus,
      allValidationPassed,
      dataValidation,
      event,
      apiVersion,
      country: this.asString(data.country),
      providerType: this.asString(data.type),
    });
    const result = {
      provider: KycVerificationProvider.YOUVERIFY,
      status,
      reference,
      checks,
      documentType: this.mapDocumentType(this.asString(data.type)),
      country: this.asString(data.country),
      errorMessage: this.resolveErrorMessage(
        status,
        this.asString(data.reason),
      ),
    };

    return {
      ...result,
      responseHash: this.hash(result),
    };
  }

  private normalizeIdentityResult(
    response: YouverifyResponse,
    context: {
      country: 'NG' | 'GH';
      type: KYCType;
      identifierMasked: string;
    },
  ): KycProviderResult {
    const data = response.data;
    const reference = this.asString(data?.id);
    if (!reference) {
      throw new ServiceUnavailableException(
        'Youverify returned an invalid verification response',
      );
    }

    const providerStatus = this.asString(data?.status)?.toLowerCase();
    const allValidationPassed = this.asBoolean(data?.allValidationPassed);
    const dataValidation = this.asBoolean(data?.dataValidation);
    const status = this.normalizeStatus(providerStatus, allValidationPassed);
    const checks = this.buildChecks({
      providerStatus,
      allValidationPassed,
      dataValidation,
      country: context.country,
      providerType: this.providerType(context.country, context.type),
      documentType: context.type,
      identifierMasked: context.identifierMasked,
    });
    const result = {
      provider: KycVerificationProvider.YOUVERIFY,
      status,
      reference,
      checks,
      errorMessage: this.resolveErrorMessage(
        status,
        this.asString(data?.reason) || response.message,
      ),
    };

    return {
      ...result,
      responseHash: this.hash(result),
    };
  }

  private normalizeStatus(
    providerStatus: string | undefined,
    allValidationPassed: boolean | undefined,
  ): KycVerificationStatus {
    if (
      ['pending', 'processing', 'in_progress'].includes(providerStatus ?? '')
    ) {
      return KycVerificationStatus.PENDING;
    }
    if (
      ['not_found', 'not found', 'rejected', 'declined'].includes(
        providerStatus ?? '',
      )
    ) {
      return KycVerificationStatus.REJECTED;
    }
    if (['failed', 'error', 'unavailable'].includes(providerStatus ?? '')) {
      return KycVerificationStatus.FAILED;
    }
    if (providerStatus === 'found') {
      return allValidationPassed === true
        ? KycVerificationStatus.VERIFIED
        : KycVerificationStatus.REVIEW_REQUIRED;
    }
    return KycVerificationStatus.REVIEW_REQUIRED;
  }

  private resolveEndpoint(country: 'NG' | 'GH', type: KYCType) {
    const providerType = this.providerType(country, type);
    return `/v2/api/identity/${country.toLowerCase()}/${providerType}`;
  }

  private providerType(country: 'NG' | 'GH', type: KYCType) {
    const endpoints: Partial<Record<KYCType, string>> =
      country === 'NG'
        ? {
            BVN: 'bvn',
            NIN: 'nin',
            DRIVERS_LICENSE: 'drivers-license',
            VOTERS_CARD: 'pvc',
          }
        : {
            PASSPORT: 'passport',
            VOTERS_CARD: 'voter',
          };
    const endpoint = endpoints[type];
    if (!endpoint) {
      throw new BadRequestException(
        `${type} verification is not supported for ${country}`,
      );
    }
    return endpoint;
  }

  private compactValidation(
    validation: KycIdentityVerificationRequest['validation'],
  ) {
    const firstName = validation?.firstName?.trim();
    const lastName = validation?.lastName?.trim();
    if (!firstName && !lastName) return undefined;

    return {
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
    };
  }

  private buildChecks(input: {
    providerStatus?: string;
    allValidationPassed?: boolean;
    dataValidation?: boolean;
    event?: string;
    apiVersion?: string;
    country?: string;
    providerType?: string;
    documentType?: KYCType;
    identifierMasked?: string;
  }): Prisma.InputJsonObject {
    return {
      ...(input.providerStatus !== undefined
        ? { providerStatus: input.providerStatus }
        : {}),
      ...(input.allValidationPassed !== undefined
        ? { allValidationPassed: input.allValidationPassed }
        : {}),
      ...(input.dataValidation !== undefined
        ? { dataValidation: input.dataValidation }
        : {}),
      ...(input.event !== undefined ? { event: input.event } : {}),
      ...(input.apiVersion !== undefined
        ? { apiVersion: input.apiVersion }
        : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.providerType !== undefined
        ? { providerType: input.providerType }
        : {}),
      ...(input.documentType !== undefined
        ? { documentType: input.documentType }
        : {}),
      ...(input.identifierMasked !== undefined
        ? { identifierMasked: input.identifierMasked }
        : {}),
      reviewRequired:
        this.normalizeStatus(
          input.providerStatus,
          input.allValidationPassed,
        ) === KycVerificationStatus.REVIEW_REQUIRED,
    };
  }

  private resolveErrorMessage(status: KycVerificationStatus, reason?: string) {
    if (
      status !== KycVerificationStatus.REJECTED &&
      status !== KycVerificationStatus.FAILED
    ) {
      return undefined;
    }
    return reason || 'Youverify identity verification did not pass';
  }

  private mapDocumentType(type?: string): KYCType | undefined {
    const normalized = type?.trim().toLowerCase();
    const mapping: Record<string, KYCType> = {
      bvn: KYCType.BVN,
      nin: KYCType.NIN,
      passport: KYCType.PASSPORT,
      ndl: KYCType.DRIVERS_LICENSE,
      'drivers-license': KYCType.DRIVERS_LICENSE,
      drivers_license: KYCType.DRIVERS_LICENSE,
      pvc: KYCType.VOTERS_CARD,
      inec: KYCType.VOTERS_CARD,
      voter: KYCType.VOTERS_CARD,
    };
    return normalized ? mapping[normalized] : undefined;
  }

  private get baseUrl() {
    return (
      this.configService.get<string>('YOUVERIFY_BASE_URL') ||
      DEFAULT_YOUVERIFY_BASE_URL
    ).replace(/\/$/, '');
  }

  private getRequiredConfig(key: string) {
    const value = this.configService.get<string>(key);
    if (!value?.trim()) {
      throw new ServiceUnavailableException(
        'Identity verification is not configured',
      );
    }
    return value.trim();
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

  private asBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : undefined;
  }
}
