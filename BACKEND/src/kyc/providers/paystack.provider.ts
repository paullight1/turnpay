import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  KYCType,
  KycVerificationProvider,
  KycVerificationStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PaystackClient } from '../../paystack/paystack.client';
import { PrismaService } from '../../prisma/prisma.service';
import { maskAccountNumber } from '../../common/utils/masking';
import {
  KycIdentityVerificationRequest,
  KycProviderDefinitiveFailure,
  KycProviderGateway,
  KycProviderResult,
} from './kyc-provider.gateway';

/**
 * Paystack's Nigerian customer validation is an asynchronous BVN + bank
 * account check. The accepted request is therefore deliberately persisted as
 * PENDING; only a signed customeridentification webhook can complete it.
 */
@Injectable()
export class PaystackProvider implements KycProviderGateway {
  readonly provider = KycVerificationProvider.PAYSTACK;

  constructor(
    private readonly paystack: PaystackClient,
    private readonly prisma: PrismaService,
  ) {}

  async verifyIdentity(
    request: KycIdentityVerificationRequest,
  ): Promise<KycProviderResult> {
    this.assertValidRequest(request);

    const customer = await this.paystack.ensureCustomer(request.userId);
    const firstName = request.validation?.firstName;
    const lastName = request.validation?.lastName;
    const accountNumber = request.validation?.accountNumber;
    const bankCode = request.validation?.bankCode;
    const accountSetupConsent =
      request.validation?.accountSetupConsent === true;
    const validationFingerprint = this.buildValidationFingerprint({
      bvn: request.identifier,
      accountNumber: accountNumber!,
      bankCode: bankCode!,
      firstName: firstName!,
      lastName: lastName!,
    });
    const existingCustomer = await this.prisma.paystackCustomer.findUnique({
      where: { userId: request.userId },
      select: { validationFingerprint: true, validationStatus: true },
    });
    if (existingCustomer?.validationStatus === 'VERIFIED') {
      throw new ConflictException(
        'Paystack identity verification is already complete',
      );
    }
    if (
      existingCustomer?.validationFingerprint &&
      existingCustomer.validationFingerprint !== validationFingerprint
    ) {
      throw new BadRequestException(
        'Paystack identity details cannot be changed after a validation attempt; contact support',
      );
    }

    // Persist the correlation key and consent before the provider call. A
    // very fast webhook can arrive before Paystack returns its 202 response;
    // the worker must still be able to find this exact pending attempt.
    const correlationUpdate = await this.prisma.kycVerification.updateMany({
      where: { documentId: request.documentId, status: 'PENDING' },
      data: {
        checks: {
          customerCode: customer.customerCode,
          validationFingerprint,
          accountSetupConsent,
        },
      },
    });
    if (correlationUpdate.count !== 1) {
      throw new ConflictException(
        'Paystack verification reservation is no longer pending',
      );
    }
    await this.prisma.paystackCustomer.update({
      where: { userId: request.userId },
      data: {
        validationFingerprint,
        ...(existingCustomer?.validationStatus === 'VERIFIED'
          ? {}
          : { validationStatus: 'PENDING' }),
        ...(accountSetupConsent ? { accountSetupConsentAt: new Date() } : {}),
      },
    });

    let providerStatus = 'accepted';
    try {
      await this.paystack.request(
        'POST',
        `/customer/${customer.customerCode}/identification`,
        {
          country: 'NG',
          type: 'bank_account',
          account_number: accountNumber,
          bvn: request.identifier,
          bank_code: bankCode,
          first_name: firstName,
          last_name: lastName,
        },
      );
    } catch (error: unknown) {
      if (this.isDefinitiveValidationFailure(error)) {
        throw new KycProviderDefinitiveFailure(
          KycVerificationProvider.PAYSTACK,
          'Paystack identity validation was rejected. Review your details and try again.',
          validationFingerprint,
        );
      }
      if (!(error instanceof ServiceUnavailableException)) {
        throw error;
      }
      // The provider may have accepted the request before the network failed.
      // Keep the reservation pending; signed callbacks/requery own the final
      // outcome and a retry must not create a duplicate validation.
      providerStatus = 'confirmation_pending';
    }

    const checks = {
      providerStatus,
      country: 'NG',
      providerType: 'bank_account',
      documentType: 'BVN',
      identifierMasked: request.identifierMasked,
      customerCode: customer.customerCode,
      validationFingerprint,
      accountNumberMasked: maskAccountNumber(accountNumber!),
      bankCode: bankCode!,
      accountSetupConsent,
      reviewRequired: false,
      verified: false,
    } satisfies Prisma.InputJsonObject;
    const reference = `paystack:customer:${customer.customerCode}:verification:${request.documentId}`;
    const responseHash = createHash('sha256')
      .update(JSON.stringify({ reference, checks }))
      .digest('hex');

    return {
      provider: KycVerificationProvider.PAYSTACK,
      status: KycVerificationStatus.PENDING,
      reference,
      checks,
      responseHash,
    };
  }

  private assertValidRequest(request: KycIdentityVerificationRequest) {
    if (request.country !== 'NG' || request.type !== KYCType.BVN) {
      throw new BadRequestException(
        'Paystack supports Nigerian BVN verification only',
      );
    }
    if (!/^\d{11}$/.test(request.identifier)) {
      throw new BadRequestException('BVN must be 11 digits');
    }
    if (request.consentAccepted !== true) {
      throw new BadRequestException('KYC consent is required');
    }
    if (
      !request.validation?.firstName ||
      !request.validation.lastName ||
      !request.validation.accountNumber ||
      !/^\d{10}$/.test(request.validation.accountNumber) ||
      !request.validation.bankCode
    ) {
      throw new BadRequestException(
        'Bank code and account number are required for Paystack BVN verification',
      );
    }
  }

  private buildValidationFingerprint(input: {
    bvn: string;
    accountNumber: string;
    bankCode: string;
    firstName: string;
    lastName: string;
  }) {
    return createHash('sha256')
      .update(
        [
          input.bvn,
          input.accountNumber,
          input.bankCode,
          input.firstName,
          input.lastName,
        ]
          .map((value) => value.trim().toUpperCase())
          .join('|'),
      )
      .digest('hex');
  }

  private isDefinitiveValidationFailure(error: unknown) {
    if (!(error instanceof BadRequestException)) return false;
    const cause = error.cause;
    if (!cause || typeof cause !== 'object' || Array.isArray(cause)) {
      return false;
    }
    const providerStatusCode = (cause as { providerStatusCode?: unknown })
      .providerStatusCode;
    return providerStatusCode === 400 || providerStatusCode === 422;
  }
}
