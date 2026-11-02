import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { CircuitBreakerService } from '../../common/services/circuit-breaker.service';
import {
  KycIdentityVerificationRequest,
  KycProviderGateway,
  KycProviderResult,
} from './kyc-provider.gateway';

/** NIN match-only integration. No registry records are persisted or logged. */
@Injectable()
export class NinjaProvider implements KycProviderGateway {
  readonly provider = 'NINJA' as const;
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @Optional() private readonly circuit?: CircuitBreakerService,
  ) {}

  get configured() {
    const base = this.config.get<string>(
      'NINJA_BASE_URL',
      'https://api.ninja.boucloud.io',
    );
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const key = this.config.get<string>('NINJA_SECRET_KEY', '');
    return (
      String(this.config.get('NINJA_NIN_ENABLED', false)) === 'true' &&
      !!key &&
      [
        'https://api.ninja.boucloud.io',
        'https://api.sandbox.ninja.boucloud.io',
      ].includes(base) &&
      (!production ||
        (base === 'https://api.ninja.boucloud.io' &&
          key.startsWith('sk_') &&
          !key.startsWith('sk_sandbox_')))
    );
  }

  async verifyIdentity(
    request: KycIdentityVerificationRequest,
  ): Promise<KycProviderResult> {
    if (!this.configured)
      throw new ServiceUnavailableException(
        'NIN verification is currently unavailable',
      );
    const { firstName, lastName, dateOfBirth } = request.validation ?? {};
    if (
      request.type !== 'NIN' ||
      request.country !== 'NG' ||
      !/^\d{11}$/.test(request.identifier) ||
      !firstName ||
      !lastName ||
      !dateOfBirth ||
      request.consentAccepted !== true
    )
      throw new BadRequestException(
        'NIN verification requires your legal name, date of birth and consent',
      );
    if (this.circuit && !(await this.circuit.canExecute('ninja-nin')))
      throw new ServiceUnavailableException(
        'NIN verification is temporarily unavailable',
      );
    let body: Record<string, unknown>;
    try {
      const response = await firstValueFrom(
        this.http.post<Record<string, unknown>>(
          `${this.config.get<string>('NINJA_BASE_URL', 'https://api.ninja.boucloud.io')}/api/identity/identify`,
          {
            idType: 'nin',
            mode: 'verify',
            idNumber: request.identifier,
            firstName,
            lastName,
            dateOfBirth,
            reference: request.documentId,
            rules: {
              accept_score: 1,
              review_score: 0.6,
              allow_transposed_names: false,
              fields: [
                { field: 'first_name', match: 'exact_ci', required: true },
                { field: 'last_name', match: 'exact_ci', required: true },
                { field: 'date_of_birth', match: 'date', required: true },
              ],
            },
          },
          {
            headers: {
              Authorization: `Bearer ${this.config.get<string>('NINJA_SECRET_KEY')}`,
            },
            timeout: 15000,
            maxRedirects: 0,
          },
        ),
      );
      body =
        response.data && typeof response.data === 'object' ? response.data : {};
      await this.circuit?.recordSuccess('ninja-nin');
    } catch {
      await this.circuit?.recordFailure('ninja-nin');
      throw new ServiceUnavailableException(
        'NIN verification is temporarily unavailable',
      );
    }
    const fields = Array.isArray(body.fields)
      ? body.fields.filter(
          (field): field is Record<string, unknown> =>
            !!field && typeof field === 'object',
        )
      : [];
    const verified =
      body.found === true &&
      body.verified === true &&
      body.recommendation === 'accept' &&
      body.score === 1 &&
      ['first_name', 'last_name', 'date_of_birth'].every((name) =>
        fields.some(
          (field) =>
            field.field === name &&
            field.score === 1 &&
            field.match === 'exact',
        ),
      );
    const status = verified
      ? 'VERIFIED'
      : body.found === false || body.recommendation === 'reject'
        ? 'REJECTED'
        : 'REVIEW_REQUIRED';
    const checks = {
      country: 'NG',
      documentType: 'NIN',
      identifierMasked: request.identifierMasked,
      found: body.found === true,
      verified,
      reviewRequired: status === 'REVIEW_REQUIRED',
    };
    return {
      provider: this.provider,
      status,
      reference: `ninja:${request.documentId}`,
      checks,
      responseHash: createHash('sha256')
        .update(JSON.stringify(checks))
        .digest('hex'),
      ...(status === 'REJECTED'
        ? {
            errorMessage:
              'We could not match your NIN to your verified identity. Check your details or contact support.',
          }
        : {}),
    };
  }
}
