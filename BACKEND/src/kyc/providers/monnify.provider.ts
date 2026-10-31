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
import { firstValueFrom } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';
import { CircuitBreakerService } from '../../common/services/circuit-breaker.service';
import {
  KycIdentityVerificationRequest,
  KycProviderGateway,
  KycProviderResult,
} from './kyc-provider.gateway';

type MonnifyResponse = {
  requestSuccessful?: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: Record<string, unknown>;
};

const MONNIFY_KYC_CIRCUIT = 'monnify-kyc';

@Injectable()
export class MonnifyProvider implements KycProviderGateway {
  readonly provider = KycVerificationProvider.MONNIFY;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async verifyIdentity(
    request: KycIdentityVerificationRequest,
  ): Promise<KycProviderResult> {
    this.assertValidRequest(request);
    if (!(await this.circuitBreaker.canExecute(MONNIFY_KYC_CIRCUIT))) {
      throw new ServiceUnavailableException(
        'Identity verification is temporarily unavailable',
      );
    }

    try {
      const token = await this.getAccessToken();
      const response =
        request.type === KYCType.NIN
          ? await this.verifyNin(token, request)
          : await this.verifyBvn(token, request);
      const result = this.normalizeResult(response, request);
      await this.circuitBreaker.recordSuccess(MONNIFY_KYC_CIRCUIT);
      this.logger.info(
        {
          reference: result.reference,
          documentType: request.type,
          status: result.status,
        },
        'Monnify identity verification completed',
      );
      return result;
    } catch (error: unknown) {
      await this.circuitBreaker.recordFailure(MONNIFY_KYC_CIRCUIT);
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(
        {
          documentType: request.type,
          upstreamStatusCode: isAxiosError(error)
            ? error.response?.status
            : undefined,
        },
        'Monnify identity verification failed',
      );
      throw new ServiceUnavailableException(
        'Identity verification could not be completed',
      );
    }
  }

  private async verifyNin(
    token: string,
    request: KycIdentityVerificationRequest,
  ) {
    return this.postVerification(token, '/api/v1/vas/nin-verification', {
      nin: request.identifier,
    });
  }

  private async verifyBvn(
    token: string,
    request: KycIdentityVerificationRequest,
  ) {
    const name = [request.validation?.firstName, request.validation?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (
      !name ||
      !request.validation?.dateOfBirth ||
      !request.validation.phone
    ) {
      throw new BadRequestException(
        'Full name, date of birth, and phone are required for BVN verification',
      );
    }

    return this.postVerification(token, '/api/v1/vas/bvn-details-match', {
      bvn: request.identifier,
      name,
      dateOfBirth: this.formatMonnifyDate(request.validation.dateOfBirth),
      mobileNo: this.toNigerianPhone(request.validation.phone),
    });
  }

  private async postVerification(
    token: string,
    path: string,
    payload: Record<string, string>,
  ) {
    try {
      const response = await firstValueFrom(
        this.httpService.post<MonnifyResponse>(
          `${this.baseUrl}${path}`,
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
    } catch (error) {
      throw new ServiceUnavailableException(
        isAxiosError(error) && error.response?.status === 401
          ? 'Monnify authentication failed'
          : 'Monnify verification service is unavailable',
      );
    }
  }

  private normalizeResult(
    response: MonnifyResponse,
    request: KycIdentityVerificationRequest,
  ): KycProviderResult {
    const body = response.responseBody ?? {};
    const matched =
      request.type === KYCType.NIN
        ? body.ninInformationMatch === true
        : body.bvnInformationMatch === true;
    const status =
      response.requestSuccessful && matched
        ? KycVerificationStatus.VERIFIED
        : KycVerificationStatus.REJECTED;
    const result = {
      provider: KycVerificationProvider.MONNIFY,
      status,
      reference: `monnify:${request.type.toLowerCase()}:${request.documentId}`,
      checks: {
        providerStatus: response.requestSuccessful ? 'processed' : 'failed',
        found: response.requestSuccessful === true,
        verified: matched,
        ...(response.responseCode
          ? { responseCode: response.responseCode }
          : {}),
        ...(response.responseMessage
          ? { responseMessage: response.responseMessage }
          : {}),
        country: request.country,
        providerType: request.type.toLowerCase(),
        documentType: request.type,
        identifierMasked: request.identifierMasked,
        reviewRequired: false,
      } satisfies Prisma.InputJsonObject,
      errorMessage:
        status === KycVerificationStatus.REJECTED
          ? response.responseMessage || 'Identity details did not match'
          : undefined,
    };
    return {
      ...result,
      responseHash: createHash('sha256')
        .update(JSON.stringify(result))
        .digest('hex'),
    };
  }

  private async getAccessToken() {
    const apiKey = this.configService.get<string>('MONNIFY_API_KEY')?.trim();
    const secretKey = this.configService
      .get<string>('MONNIFY_SECRET_KEY')
      ?.trim();
    if (!apiKey || !secretKey) {
      throw new ServiceUnavailableException(
        'Monnify credentials are not configured',
      );
    }
    const basicToken = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    try {
      const response = await firstValueFrom(
        this.httpService.post<MonnifyResponse>(
          `${this.baseUrl}/api/v1/auth/login`,
          {},
          {
            headers: {
              Authorization: `Basic ${basicToken}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      const token = response.data.responseBody?.accessToken;
      if (!response.data.requestSuccessful || typeof token !== 'string') {
        throw new ServiceUnavailableException('Monnify authentication failed');
      }
      return token;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Monnify authentication failed');
    }
  }

  private assertValidRequest(request: KycIdentityVerificationRequest) {
    if (request.country !== 'NG' || !/^\d{11}$/.test(request.identifier)) {
      throw new BadRequestException(
        'Monnify supports Nigerian 11-digit IDs only',
      );
    }
    if (request.type !== KYCType.NIN && request.type !== KYCType.BVN) {
      throw new BadRequestException('Monnify supports BVN and NIN only');
    }
    if (request.consentAccepted !== true) {
      throw new BadRequestException('KYC consent is required');
    }
  }

  private formatMonnifyDate(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('A valid date of birth is required');
    }
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${String(date.getUTCDate()).padStart(2, '0')}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
  }

  private toNigerianPhone(phone: string) {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('234') && digits.length === 13)
      return `0${digits.slice(3)}`;
    if (digits.length === 11 && digits.startsWith('0')) return digits;
    throw new BadRequestException('A valid Nigerian phone number is required');
  }

  private get baseUrl() {
    const configured = this.configService.get<string>('MONNIFY_BASE_URL');
    if (configured) return configured.replace(/\/$/, '');
    return this.configService.get<boolean>('BANKING_SANDBOX_MODE', true)
      ? 'https://sandbox.monnify.com'
      : 'https://api.monnify.com';
  }
}
