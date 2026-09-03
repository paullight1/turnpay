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
import { createHash } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import { CircuitBreakerService } from '../../common/services/circuit-breaker.service';
import {
  KycIdentityVerificationRequest,
  KycProviderCallbackResult,
  KycProviderGateway,
  KycProviderResult,
} from './kyc-provider.gateway';

type NinjaSessionResponse = {
  token?: unknown;
  expiry?: unknown;
};

type NinjaVerificationResponse = {
  id?: unknown;
  found?: unknown;
  verified?: unknown;
  score?: unknown;
  recommendation?: unknown;
  fields?: unknown;
};

type CachedSession = {
  token: string;
  expiresAt: number;
};

const NINJA_CIRCUIT = 'ninja';
const DEFAULT_NINJA_BASE_URL = 'https://api.sandbox.ninja.boucloud.io';
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const ALLOWED_NINJA_HOSTS = new Set([
  'api.ninja.boucloud.io',
  'api.sandbox.ninja.boucloud.io',
]);

@Injectable()
export class NinjaProvider implements KycProviderGateway {
  readonly provider = KycVerificationProvider.NINJA;

  private cachedSession?: CachedSession;
  private sessionRequest?: Promise<string>;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async verifyIdentity(
    request: KycIdentityVerificationRequest,
  ): Promise<KycProviderResult> {
    const providerType = this.assertValidRequest(request);
    const baseUrl = this.getBaseUrl();
    if (!(await this.circuitBreaker.canExecute(NINJA_CIRCUIT))) {
      throw new ServiceUnavailableException(
        'Identity verification is temporarily unavailable',
      );
    }

    const payload = {
      idType: providerType,
      mode: 'verify',
      idNumber: request.identifier,
      firstName: request.validation!.firstName!.trim(),
      lastName: request.validation!.lastName!.trim(),
      dateOfBirth: request.validation!.dateOfBirth!.trim(),
      reference: request.documentId,
    };

    try {
      let token = await this.getSessionToken(baseUrl);
      let response: NinjaVerificationResponse;
      try {
        response = await this.sendVerification(baseUrl, token, payload);
      } catch (error: unknown) {
        if (!this.isUnauthorized(error)) throw error;
        token = await this.getSessionToken(baseUrl, true);
        response = await this.sendVerification(baseUrl, token, payload);
      }

      const result = this.normalizeIdentityResult(response, {
        reference: request.documentId,
        country: request.country,
        type: request.type,
        providerType,
        identifierMasked: request.identifierMasked,
      });
      await this.circuitBreaker.recordSuccess(NINJA_CIRCUIT);
      this.logger.info(
        {
          reference: result.reference,
          country: request.country,
          documentType: request.type,
          status: result.status,
        },
        'Ninja identity verification completed',
      );
      return result;
    } catch (error: unknown) {
      await this.circuitBreaker.recordFailure(NINJA_CIRCUIT);
      const upstreamStatusCode = isAxiosError(error)
        ? error.response?.status
        : undefined;
      this.logger.warn(
        {
          country: request.country,
          documentType: request.type,
          upstreamStatusCode,
        },
        'Ninja identity verification failed',
      );
      throw new ServiceUnavailableException(
        'Identity verification could not be completed',
      );
    }
  }

  verifyCallbackSignature(): boolean {
    return false;
  }

  normalizeCallback(): KycProviderCallbackResult {
    throw new BadRequestException(
      'Ninja direct verification does not accept callbacks',
    );
  }

  private assertValidRequest(request: KycIdentityVerificationRequest) {
    if (request.consentAccepted !== true) {
      throw new BadRequestException('KYC consent is required');
    }
    if (request.country !== 'NG' || !['BVN', 'NIN'].includes(request.type)) {
      throw new BadRequestException(
        'Identity type is not supported for the selected country',
      );
    }

    const firstName = request.validation?.firstName?.trim();
    const lastName = request.validation?.lastName?.trim();
    const dateOfBirth = request.validation?.dateOfBirth?.trim();
    if (!firstName || !lastName || !dateOfBirth) {
      throw new BadRequestException(
        'Legal first name, last name, and date of birth are required',
      );
    }
    return request.type.toLowerCase() as 'bvn' | 'nin';
  }

  private async getSessionToken(baseUrl: string, forceRefresh = false) {
    if (forceRefresh) this.cachedSession = undefined;
    if (
      this.cachedSession &&
      this.cachedSession.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()
    ) {
      return this.cachedSession.token;
    }
    if (this.sessionRequest) return this.sessionRequest;

    const request = this.requestSessionToken(baseUrl);
    this.sessionRequest = request;
    try {
      return await request;
    } finally {
      if (this.sessionRequest === request) this.sessionRequest = undefined;
    }
  }

  private async requestSessionToken(baseUrl: string) {
    const response = await firstValueFrom(
      this.httpService.post<{ token?: unknown; expiry?: unknown }>(
        `${baseUrl}/auth/session`,
        {
          client_key: this.getRequiredConfig('NINJA_CLIENT_KEY'),
          client_secret: this.getRequiredConfig('NINJA_CLIENT_SECRET'),
        },
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const data: NinjaSessionResponse = response.data;
    const token = this.asString(data.token);
    const expiry = this.asString(data.expiry);
    const expiresAt = expiry ? Date.parse(expiry) : Number.NaN;
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new ServiceUnavailableException(
        'Identity verification authentication failed',
      );
    }
    this.cachedSession = { token, expiresAt };
    return token;
  }

  private async sendVerification(
    baseUrl: string,
    token: string,
    payload: Record<string, string>,
  ) {
    const response = await firstValueFrom(
      this.httpService.post<NinjaVerificationResponse>(
        `${baseUrl}/api/identity/identify`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    return response.data;
  }

  private normalizeIdentityResult(
    response: NinjaVerificationResponse,
    context: {
      reference: string;
      country: 'NG' | 'GH';
      type: KYCType;
      providerType: 'bvn' | 'nin';
      identifierMasked: string;
    },
  ): KycProviderResult {
    const found = this.asBoolean(response.found);
    if (found === undefined) {
      throw new ServiceUnavailableException(
        'Ninja returned an invalid verification response',
      );
    }
    const verified = this.asBoolean(response.verified) ?? false;
    const recommendation = this.asString(
      response.recommendation,
    )?.toLowerCase();
    const status = this.normalizeStatus(found, verified, recommendation);
    const score = this.asScore(response.score);
    const checks: Prisma.InputJsonObject = {
      providerStatus: found ? 'found' : 'not_found',
      found,
      verified,
      ...(recommendation ? { recommendation } : {}),
      ...(score !== undefined ? { score } : {}),
      fields: this.sanitizeFields(response.fields),
      country: context.country,
      providerType: context.providerType,
      documentType: context.type,
      identifierMasked: context.identifierMasked,
      reviewRequired: status === KycVerificationStatus.REVIEW_REQUIRED,
    };
    const result = {
      provider: KycVerificationProvider.NINJA,
      status,
      reference: context.reference,
      checks,
      errorMessage:
        status === KycVerificationStatus.REJECTED
          ? 'Identity details did not match'
          : undefined,
    };
    return { ...result, responseHash: this.hash(result) };
  }

  private normalizeStatus(
    found: boolean,
    verified: boolean,
    recommendation?: string,
  ) {
    if (!found) return KycVerificationStatus.REJECTED;
    if (verified && recommendation === 'accept') {
      return KycVerificationStatus.VERIFIED;
    }
    if (recommendation === 'reject') return KycVerificationStatus.REJECTED;
    return KycVerificationStatus.REVIEW_REQUIRED;
  }

  private sanitizeFields(value: unknown): Prisma.InputJsonArray {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): Prisma.InputJsonObject[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const field = this.asString(record.field);
      const match = this.asString(record.match);
      const score = this.asScore(record.score);
      if (!field) return [];
      return [
        {
          field,
          ...(match ? { match } : {}),
          ...(score !== undefined ? { score } : {}),
        },
      ];
    });
  }

  private getBaseUrl() {
    const configured =
      this.configService.get<string>('NINJA_BASE_URL') ||
      DEFAULT_NINJA_BASE_URL;
    try {
      const url = new URL(configured);
      if (url.protocol !== 'https:' || !ALLOWED_NINJA_HOSTS.has(url.hostname)) {
        throw new Error('Untrusted Ninja API host');
      }
      return url.origin;
    } catch {
      throw new ServiceUnavailableException(
        'Identity verification is not configured',
      );
    }
  }

  private getRequiredConfig(key: string) {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(
        'Identity verification is not configured',
      );
    }
    return value;
  }

  private isUnauthorized(error: unknown) {
    return isAxiosError(error) && error.response?.status === 401;
  }

  private asString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private asBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : undefined;
  }

  private asScore(value: unknown) {
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1
      ? value
      : undefined;
  }

  private hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
