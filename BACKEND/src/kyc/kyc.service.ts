import { NinjaProvider } from './providers/ninja.provider';
import { AccountNotificationsService } from '../notifications/account-notifications.service';
import { TierOneLimitsService } from '../common/services/tier-one-limits.service';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateKycUploadDto,
  ReviewKycDto,
  CreateDisputeDto,
  ResolveDisputeDto,
  CreateIdentityVerificationDto,
  CreateManualKycDocumentDto,
} from './dto/kyc.dto';
import { PinoLogger } from 'nestjs-pino';
import { DisputeStatus, KycVerificationStatus } from '@prisma/client';
import { SupabaseService } from '../supabase/supabase.service';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '../common/utils/encryption';
import {
  KYC_PROVIDER_GATEWAY,
  KycProviderDefinitiveFailure,
} from './providers/kyc-provider.gateway';
import type {
  KycProviderGateway,
  KycProviderResult,
} from './providers/kyc-provider.gateway';
import { KYCTier, KYCType, Prisma } from '@prisma/client';
import { BankingService } from '../banking/banking.service';
import { toPaystackRecoveryView } from './paystack-kyc-recovery.types';
import { PaystackKycRecoveryService } from './paystack-kyc-recovery.service';

const DEFAULT_KYC_DOCUMENT_BUCKET = 'kyc-documents';
const DEFAULT_ADMIN_DOCUMENT_URL_TTL_SECONDS = 300;
const PROVIDER_CONSENT_SOURCE = 'WEB_OR_MOBILE';
const PROVIDER_UNAVAILABLE_MESSAGE =
  'Identity verification is temporarily unavailable';
const PROVIDER_VALIDATION_REJECTED_MESSAGE =
  'Identity details were rejected. Review your details and try again.';
const SAFE_KYC_REVIEW_CHECK_KEYS = [
  'providerStatus',
  'allValidationPassed',
  'dataValidation',
  'country',
  'providerType',
  'documentType',
  'identifierMasked',
  'reviewRequired',
  'found',
  'verified',
  'recommendation',
  'score',
  'fields',
] as const;
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly supabaseService: SupabaseService,
    @Inject(KYC_PROVIDER_GATEWAY)
    private readonly kycProviderGateway: KycProviderGateway,
    private readonly bankingService: BankingService,
    @Optional() private readonly ninjaProvider?: NinjaProvider,
    @Optional()
    private readonly accountNotifications?: AccountNotificationsService,
    @Optional() private readonly paystackRecovery?: PaystackKycRecoveryService,
  ) {}

  async createDocumentUploadUrl(userId: string, dto: CreateKycUploadDto) {
    const extension = CONTENT_TYPE_EXTENSIONS[dto.contentType];

    if (!extension) {
      throw new BadRequestException('Unsupported document file type');
    }

    const objectKey = `kyc/${userId}/${Date.now()}-${randomUUID()}${extension}`;
    const bucket = this.getKycDocumentBucket();
    const signedUpload = await this.supabaseService.createSignedUploadUrl(
      bucket,
      objectKey,
    );

    this.logger.info({ userId, objectKey }, 'KYC upload URL created');

    return {
      bucket,
      objectKey,
      token: signedUpload.token,
      signedUrl: signedUpload.signedUrl,
      expiresInSeconds: 7200,
    };
  }

  async verifyIdentity(userId: string, dto: CreateIdentityVerificationDto) {
    const gateway =
      dto.type === 'NIN' && this.kycProviderGateway.provider === 'PAYSTACK'
        ? this.ninjaProvider
        : this.kycProviderGateway;
    if (
      !gateway ||
      (gateway.provider === 'NINJA' && !this.ninjaProvider?.configured)
    ) {
      throw new BadRequestException(
        'NIN verification is currently unavailable. Use the document review option.',
      );
    }
    const provider = gateway.provider;
    this.assertSupportedIdentityType(dto.country, dto.type);
    this.assertValidDateOfBirth(dto.dateOfBirth);
    const normalizedIdNumber = this.normalizeIdNumber(dto.type, dto.idNumber);
    let documentId: string = randomUUID();
    let verificationId: string = randomUUID();
    const consentRecordedAt = new Date();
    const consentVersion =
      provider === 'PAYSTACK'
        ? 'paystack-bvn-and-account-setup-consent-v1'
        : provider === 'NINJA'
          ? 'ninja-nin-verification-consent-v1'
          : 'monnify-identity-and-account-setup-consent-v2';

    if (provider === 'PAYSTACK') {
      this.assertPaystackIdentityInput(dto);
    }
    if (
      dto.retryPending &&
      (provider !== 'PAYSTACK' ||
        dto.type !== 'BVN' ||
        !(await this.paystackRecovery?.reconcile(userId))?.retryAllowed)
    )
      throw new ConflictException(
        'Check your BVN status before retrying. A confirmed stale submission is required.',
      );

    let reservation: {
      document: {
        id: string;
        userId: string;
        type: KYCType;
        documentUrl: string | null;
        idNumber: string | null;
        status: string;
        rejectionNote?: string | null;
        createdAt?: Date;
        updatedAt?: Date;
      };
      user: {
        fullName: string | null;
        phone: string;
        kycStatus: 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
        kycTier: KYCTier;
      };
    };

    try {
      reservation = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            fullName: true,
            phone: true,
            kycStatus: true,
            kycTier: true,
          },
        });
        if (!user) {
          throw new NotFoundException('User not found');
        }
        if (provider === 'NINJA') {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`,
          );
          const bvn = await tx.kycDocument.findFirst({
            where: { userId, type: 'BVN', status: 'VERIFIED' },
            select: { id: true },
          });
          if (!bvn)
            throw new BadRequestException(
              'Verify your BVN to activate Tier 1 before adding NIN',
            );
          const existing = await tx.kycDocument.findFirst({
            where: {
              userId,
              type: 'NIN',
              status: { in: ['PENDING', 'SUBMITTED', 'VERIFIED'] },
            },
            select: { id: true },
          });
          if (existing)
            throw new ConflictException(
              'Your NIN is already verified or under review',
            );
          const name = this.toNameValidation(user.fullName);
          if (!name?.firstName || !name.lastName)
            throw new BadRequestException(
              'Your verified legal name is required for NIN verification',
            );
        }
        if (provider === 'MONNIFY') {
          const verifiedNin = await tx.kycDocument.findFirst({
            where: {
              userId,
              status: 'VERIFIED',
              type: 'NIN',
            },
            select: { id: true },
          });
          if (dto.type === 'BVN' && !verifiedNin) {
            throw new BadRequestException(
              'Verify your NIN before submitting your BVN',
            );
          }
          if (dto.type === 'NIN' && verifiedNin) {
            throw new ConflictException('Your NIN is already verified');
          }
        }
        if (provider === 'PAYSTACK') {
          if (typeof tx.$queryRaw === 'function') {
            // Serialize the pending-attempt check with the reservation insert
            // so two idempotency keys cannot create concurrent Paystack
            // identity submissions for the same user.
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`,
            );
          }

          const nameValidation = this.toNameValidation(
            [dto.firstName, dto.lastName].filter(Boolean).join(' ') ||
              user.fullName,
          );
          if (!nameValidation?.firstName || !nameValidation.lastName) {
            throw new BadRequestException(
              'Complete your legal first and last name before identity verification',
            );
          }

          const validationFingerprint = this.buildPaystackValidationFingerprint(
            {
              bvn: normalizedIdNumber,
              accountNumber: dto.accountNumber!,
              bankCode: dto.bankCode!,
              firstName: nameValidation.firstName,
              lastName: nameValidation.lastName,
            },
          );
          const paystackBinding =
            typeof tx.paystackCustomer?.findUnique === 'function'
              ? await tx.paystackCustomer.findUnique({
                  where: { userId },
                  select: {
                    customerCode: true,
                    validationFingerprint: true,
                    validationStatus: true,
                  },
                })
              : null;

          if (paystackBinding?.validationStatus === 'VERIFIED') {
            throw new ConflictException(
              'Paystack identity verification is already complete',
            );
          }
          if (
            paystackBinding?.validationFingerprint &&
            paystackBinding.validationFingerprint !== validationFingerprint
          ) {
            throw new BadRequestException(
              'Paystack identity details cannot be changed after a validation attempt; contact support',
            );
          }

          const activeAttempt =
            typeof tx.kycVerification.findFirst === 'function'
              ? await tx.kycVerification.findFirst({
                  where: {
                    userId,
                    provider: 'PAYSTACK',
                    status: { in: ['PENDING', 'REVIEW_REQUIRED'] },
                    document: { is: { type: 'BVN' } },
                  },
                  select: { id: true },
                })
              : null;
          if (activeAttempt && !dto.retryPending) {
            throw new ConflictException(
              'A Paystack identity verification is already in progress',
            );
          }

          // Paystack identification callbacks carry a customer identity, not
          // an internal attempt id. Once a binding has a fingerprint, a retry
          // reuses the canonical verification for that exact customer and
          // fingerprint, including explicitly recovered stale submissions.
          // Creating a fresh pending row
          // would let a delayed callback for the old attempt approve it.
          let reusableAttempt:
            | (Awaited<
                ReturnType<typeof tx.kycVerification.findMany>
              >[number] & {
                document?: Awaited<
                  ReturnType<typeof tx.kycDocument.findUnique>
                >;
              })
            | undefined;
          if (paystackBinding?.validationFingerprint) {
            const previousAttemptsResult =
              typeof tx.kycVerification.findMany === 'function'
                ? await tx.kycVerification.findMany({
                    where: {
                      userId,
                      provider: 'PAYSTACK',
                      document: { is: { type: 'BVN' } },
                    },
                    orderBy: { createdAt: 'asc' },
                    include: { document: true },
                  })
                : [];
            const previousAttempts = Array.isArray(previousAttemptsResult)
              ? previousAttemptsResult
              : [];
            reusableAttempt = previousAttempts.find((candidate) => {
              const checks = this.asJsonRecord(candidate.checks);
              return (
                (candidate.status === 'FAILED' ||
                  (dto.retryPending === true &&
                    candidate.id === activeAttempt?.id &&
                    candidate.status === 'PENDING')) &&
                checks.customerCode === paystackBinding.customerCode &&
                checks.validationFingerprint === validationFingerprint
              );
            });
            if (!reusableAttempt?.document) {
              throw new ConflictException(
                'Paystack identity validation requires support before retry',
              );
            }
          }

          if (reusableAttempt?.document) {
            documentId = reusableAttempt.documentId;
            verificationId = reusableAttempt.id;
            const priorChecks = {
              ...this.asJsonRecord(reusableAttempt.checks),
            };
            const recovery = this.asJsonRecord(
              priorChecks.paystackRecovery as Prisma.JsonValue,
            );
            if (dto.retryPending) {
              const checkedAt = Date.parse(
                typeof recovery.checkedAt === 'string'
                  ? recovery.checkedAt
                  : '',
              );
              const lastSubmitted = Date.parse(
                typeof recovery.resubmittedAt === 'string'
                  ? recovery.resubmittedAt
                  : reusableAttempt.createdAt.toISOString(),
              );
              if (
                recovery.retryAllowed !== true ||
                recovery.state !== 'ACTION_REQUIRED' ||
                recovery.customerIdentified !== false ||
                recovery.eventHistoryComplete !== true ||
                recovery.replayEventId ||
                !Number.isFinite(checkedAt) ||
                Date.now() - checkedAt > 60_000 ||
                !Number.isFinite(lastSubmitted) ||
                Date.now() - lastSubmitted < 86_400_000 ||
                Number(recovery.resubmissionCount ?? 0) >= 2
              ) {
                throw new ConflictException(
                  'BVN retry is unavailable. Check the current verification status.',
                );
              }
            }
            delete priorChecks.paystackRecovery;
            const retryChecks = {
              ...priorChecks,
              ...(dto.retryPending
                ? {
                    paystackRecovery: {
                      state: 'AWAITING_PROVIDER',
                      retryAllowed: false,
                      resubmissionCount:
                        Number(recovery.resubmissionCount ?? 0) + 1,
                      resubmittedAt: consentRecordedAt.toISOString(),
                    },
                  }
                : {}),
              customerCode: paystackBinding!.customerCode,
              validationFingerprint,
              accountSetupConsent: dto.accountSetupConsent === true,
            } satisfies Prisma.InputJsonObject;
            const document = await tx.kycDocument.update({
              where: { id: documentId },
              data: {
                status: 'PENDING',
                rejectionNote: null,
                reviewedBy: null,
                reviewedAt: null,
              },
            });
            await tx.kycVerification.update({
              where: { id: verificationId },
              data: {
                status: 'PENDING',
                reference: `pending:${documentId}`,
                checks: retryChecks,
                responseHash: null,
                errorMessage: null,
                consentRecordedAt,
                consentVersion,
                consentSource: PROVIDER_CONSENT_SOURCE,
              },
            });
            await tx.auditLog.create({
              data: {
                action: 'KYC_CONSENT_RECORDED',
                targetType: 'KycVerification',
                targetId: verificationId,
                metadata: {
                  userId,
                  documentId,
                  provider,
                  country: dto.country,
                  documentType: dto.type,
                  consentVersion,
                  consentSource: PROVIDER_CONSENT_SOURCE,
                  consentRecordedAt: consentRecordedAt.toISOString(),
                  retry: true,
                  pendingResubmission: dto.retryPending === true,
                  reusedCanonicalAttempt: true,
                },
              },
            });
            return { document, user };
          }
        }
        if (provider === 'MONNIFY') {
          const nameValidation = this.toNameValidation(
            [dto.firstName, dto.lastName].filter(Boolean).join(' ') ||
              user.fullName,
          );
          if (!nameValidation?.firstName || !nameValidation.lastName) {
            throw new BadRequestException(
              'Complete your legal first and last name before identity verification',
            );
          }
        }

        const document = await tx.kycDocument.create({
          data: {
            id: documentId,
            userId,
            type: dto.type,
            documentUrl: null,
            idNumber: this.encryptKycId(normalizedIdNumber),
            status: 'PENDING',
          },
        });
        await tx.kycVerification.create({
          data: {
            id: verificationId,
            userId,
            documentId,
            provider,
            status: 'PENDING',
            reference: `pending:${documentId}`,
            consentRecordedAt,
            consentVersion,
            consentSource: PROVIDER_CONSENT_SOURCE,
            ...(provider === 'PAYSTACK'
              ? {
                  checks: {
                    accountSetupConsent: dto.accountSetupConsent === true,
                  },
                }
              : {}),
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'KYC_CONSENT_RECORDED',
            targetType: 'KycVerification',
            targetId: verificationId,
            metadata: {
              userId,
              documentId,
              provider,
              country: dto.country,
              documentType: dto.type,
              consentVersion,
              consentSource: PROVIDER_CONSENT_SOURCE,
              consentRecordedAt: consentRecordedAt.toISOString(),
            },
          },
        });

        return { document, user };
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A verification for this identity type is already in progress',
        );
      }
      throw error;
    }

    let providerResult: Awaited<
      ReturnType<KycProviderGateway['verifyIdentity']>
    >;
    try {
      providerResult = await gateway.verifyIdentity({
        userId,
        documentId,
        country: dto.country,
        type: dto.type,
        identifier: normalizedIdNumber,
        identifierMasked: this.maskIdentifier(normalizedIdNumber),
        consentAccepted: dto.consentAccepted,
        validation: {
          ...this.toNameValidation(
            provider === 'NINJA'
              ? reservation.user.fullName
              : [dto.firstName, dto.lastName].filter(Boolean).join(' ') ||
                  reservation.user.fullName,
          ),
          dateOfBirth: dto.dateOfBirth,
          ...(dto.bankCode ? { bankCode: dto.bankCode } : {}),
          ...(dto.accountNumber ? { accountNumber: dto.accountNumber } : {}),
          ...(typeof dto.accountSetupConsent === 'boolean'
            ? { accountSetupConsent: dto.accountSetupConsent }
            : {}),
          ...(reservation.user.phone ? { phone: reservation.user.phone } : {}),
        },
      });
      if (providerResult.provider !== provider) {
        throw new BadRequestException('Unexpected identity provider response');
      }
    } catch (error: unknown) {
      const definitiveError =
        error instanceof KycProviderDefinitiveFailure &&
        error.provider === provider
          ? error
          : undefined;
      if (definitiveError || provider !== 'PAYSTACK') {
        const released = await this.releaseReservedProviderAttempt({
          userId,
          documentId,
          verificationId,
          country: dto.country,
          documentType: dto.type,
          provider,
          validationFingerprint: definitiveError?.validationFingerprint,
          failureMessage: definitiveError
            ? PROVIDER_VALIDATION_REJECTED_MESSAGE
            : undefined,
        });
        this.logger.warn(
          {
            userId,
            documentId,
            country: dto.country,
            documentType: dto.type,
            released,
            definitiveFailure: Boolean(definitiveError),
          },
          released
            ? 'KYC attempt released after definitive provider failure'
            : 'KYC attempt was already finalized before provider failure',
        );
      } else {
        this.logger.warn(
          { userId, documentId, country: dto.country, documentType: dto.type },
          'KYC attempt remains pending after ambiguous provider failure',
        );
      }
      throw error;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`,
        );
      }
      // An independent NIN review may have finished during the provider call.
      // Preserve its current tier/status rather than the reservation snapshot.
      const currentUser = await tx.user.findUnique({
        where: { id: userId },
        select: { kycTier: true, kycStatus: true },
      });
      if (!currentUser) throw new NotFoundException('User not found');
      let providerChecks = providerResult.checks;
      if (provider === 'PAYSTACK') {
        const current = await tx.kycVerification.findUnique({
          where: { id: verificationId },
          select: { status: true, reference: true, checks: true },
        });
        const recovery = this.asJsonRecord(current?.checks).paystackRecovery;
        if (recovery) {
          providerChecks = {
            ...providerResult.checks,
            paystackRecovery: recovery,
          };
        }
        if (current && current.status !== 'PENDING') {
          const currentDocument = await tx.kycDocument.findUnique({
            where: { id: documentId },
            select: { status: true, rejectionNote: true },
          });
          return {
            document: {
              ...reservation.document,
              status: currentDocument?.status ?? reservation.document.status,
              rejectionNote: currentDocument?.rejectionNote ?? null,
            },
            kycTier: currentUser.kycTier,
            persistedStatus: current.status as KycVerificationStatus,
            persistedReference: current.reference,
            persistedChecks: current.checks,
          };
        }
      }
      const documentStatus = this.resolveDocumentStatus(providerResult.status);
      await tx.kycDocument.update({
        where: { id: documentId },
        data: {
          status: documentStatus,
          rejectionNote: providerResult.errorMessage ?? null,
        },
      });

      await tx.kycVerification.update({
        where: { id: verificationId },
        data: {
          status: providerResult.status,
          reference: providerResult.reference,
          checks: providerChecks,
          responseHash: providerResult.responseHash,
          errorMessage: providerResult.errorMessage,
        },
      });

      const kycTier =
        providerResult.status === 'VERIFIED'
          ? await this.resolvePromotedKycTier(
              tx,
              userId,
              dto.type,
              currentUser.kycTier,
            )
          : currentUser.kycTier;
      const kycStatus =
        providerResult.status === 'VERIFIED' ||
        currentUser.kycStatus === 'VERIFIED'
          ? ('VERIFIED' as const)
          : providerResult.status === 'REJECTED'
            ? ('REJECTED' as const)
            : ('SUBMITTED' as const);

      await tx.user.update({
        where: { id: userId },
        data: { kycStatus, kycTier },
      });
      await tx.auditLog.create({
        data: {
          action: 'KYC_PROVIDER_RESULT',
          targetType: 'KycDocument',
          targetId: documentId,
          reference: providerResult.reference,
          metadata: {
            userId,
            documentId,
            provider: providerResult.provider,
            country: dto.country,
            documentType: dto.type,
            verificationStatus: providerResult.status,
            documentStatus,
            kycStatusAfter: kycStatus,
            kycTierAfter: kycTier,
            responseHash: providerResult.responseHash,
          },
        },
      });

      if (providerResult.status === 'VERIFIED' && dto.type === 'BVN') {
        await this.accountNotifications?.bvnVerified(
          tx,
          userId,
          verificationId,
        );
      }
      return {
        document: {
          ...reservation.document,
          status: documentStatus,
          rejectionNote: providerResult.errorMessage ?? null,
        },
        kycTier,
      };
    });

    const persistedStatus =
      'persistedStatus' in result ? result.persistedStatus : undefined;
    const persistedReference =
      'persistedReference' in result ? result.persistedReference : undefined;
    const persistedChecks =
      'persistedChecks' in result ? result.persistedChecks : undefined;
    const effectiveProviderResult = persistedStatus
      ? {
          ...providerResult,
          status: persistedStatus,
          reference: persistedReference ?? providerResult.reference,
          checks:
            (persistedChecks as Prisma.InputJsonObject | null) ??
            providerResult.checks,
        }
      : providerResult;

    this.logger.info(
      {
        userId,
        documentId: result.document.id,
        reference: effectiveProviderResult.reference,
        status: effectiveProviderResult.status,
      },
      'KYC provider result stored',
    );

    let accountProvisioning: {
      status: 'READY' | 'PENDING' | 'NOT_REQUIRED';
      accountNumberMasked?: string;
      bankName?: string;
    } = { status: 'NOT_REQUIRED' };
    if (providerResult.status === 'VERIFIED' && provider === 'MONNIFY') {
      try {
        const account = await this.bankingService.provisionVirtualAccount(
          userId,
          { currency: 'NGN', provider: 'monnify' },
        );
        accountProvisioning = {
          status: 'READY',
          accountNumberMasked: account.accountNumberMasked,
          bankName: account.bankName,
        };
      } catch (error: unknown) {
        this.logger.warn(
          {
            userId,
            documentId: result.document.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          provider === 'MONNIFY'
            ? 'KYC is verified; Monnify account preparation will need a retry'
            : 'KYC is verified; account preparation will need a retry',
        );
        accountProvisioning = { status: 'PENDING' };
      }
    }

    return {
      ...this.toSafeKycDocument({
        ...result.document,
        kycTier: result.kycTier,
        verifications: [
          {
            provider: effectiveProviderResult.provider,
            status: effectiveProviderResult.status,
            checks: effectiveProviderResult.checks,
          },
        ],
      }),
      reference: effectiveProviderResult.reference,
      accountProvisioning,
    };
  }

  /**
   * Completes a Paystack customer-identification callback. The callback is
   * authenticated and durably accepted by the webhook worker before this
   * method is called. Domain state is still guarded by the PENDING status so
   * retries and out-of-order terminal events cannot downgrade a decision.
   */
  async processPaystackIdentification(
    eventType: string,
    data: Record<string, unknown>,
  ) {
    const customerCode = this.readProviderString(data, 'customer_code');
    if (!customerCode) {
      return { received: true, processed: false, ignored: true };
    }

    const customer = await this.prisma.paystackCustomer.findUnique({
      where: { customerCode },
      select: {
        userId: true,
        customerCode: true,
        customerId: true,
        validationFingerprint: true,
        validationStatus: true,
      },
    });
    const rawCustomerId = data.customer_id;
    const providerCustomerId =
      typeof rawCustomerId === 'string' && /^\d+$/.test(rawCustomerId)
        ? rawCustomerId
        : typeof rawCustomerId === 'number' &&
            Number.isSafeInteger(rawCustomerId) &&
            rawCustomerId > 0
          ? String(rawCustomerId)
          : undefined;
    if (
      !customer ||
      !customer.validationFingerprint ||
      !customer.customerId ||
      providerCustomerId !== customer.customerId
    ) {
      return { received: true, processed: false, ignored: true };
    }

    const verifications = await this.prisma.kycVerification.findMany({
      where: {
        userId: customer.userId,
        provider: 'PAYSTACK',
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
      include: { document: true },
    });
    const matchingVerifications = verifications.filter((candidate) => {
      const checks = this.asJsonRecord(candidate.checks);
      return (
        checks.customerCode === customer.customerCode &&
        checks.validationFingerprint === customer.validationFingerprint
      );
    });
    if (matchingVerifications.length !== 1) {
      return { received: true, processed: false, ignored: true };
    }
    const verification = matchingVerifications[0];

    const normalizedEvent = eventType.trim().toLowerCase();
    const succeeded = normalizedEvent === 'customeridentification.success';
    const failed = normalizedEvent === 'customeridentification.failed';
    if (!succeeded && !failed) {
      return { received: true, processed: false, ignored: true };
    }

    const reason = this.readProviderString(data, 'reason');
    const result = await this.prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${customer.userId} FOR UPDATE`,
        );
      }
      const current = await tx.kycVerification.findUnique({
        where: { id: verification.id },
        select: { status: true, reference: true, checks: true },
      });
      if (!current || current.status !== 'PENDING') {
        return { received: true, processed: false, duplicate: true };
      }

      const nextStatus = succeeded ? 'VERIFIED' : 'FAILED';
      const documentStatus = succeeded ? 'VERIFIED' : 'REJECTED';
      const checks = {
        ...this.asJsonRecord(current.checks),
        providerEvent: normalizedEvent,
        verified: succeeded,
        ...(reason ? { failureReason: reason } : {}),
      } satisfies Prisma.InputJsonObject;

      const verificationUpdate = await tx.kycVerification.updateMany({
        where: { id: verification.id, status: 'PENDING' },
        data: {
          status: nextStatus,
          checks,
          errorMessage: succeeded
            ? null
            : reason || 'Customer identification failed',
        },
      });
      if (verificationUpdate.count !== 1) {
        return { received: true, processed: false, duplicate: true };
      }

      await tx.kycDocument.updateMany({
        where: {
          id: verification.documentId,
          status: { in: ['PENDING', 'SUBMITTED'] },
        },
        data: {
          status: documentStatus,
          rejectionNote: succeeded
            ? null
            : reason || 'Customer identification failed',
        },
      });

      const user = await tx.user.findUnique({
        where: { id: customer.userId },
        select: { kycStatus: true, kycTier: true },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const kycTier = succeeded
        ? await this.resolvePromotedKycTier(
            tx,
            customer.userId,
            'BVN',
            user.kycTier,
          )
        : user.kycTier;
      const kycStatus = succeeded
        ? 'VERIFIED'
        : user.kycStatus === 'VERIFIED'
          ? 'VERIFIED'
          : 'REJECTED';
      await tx.user.update({
        where: { id: customer.userId },
        data: { kycStatus, kycTier },
      });
      await tx.paystackCustomer.updateMany({
        where: {
          userId: customer.userId,
          ...(succeeded ? {} : { validationStatus: { not: 'VERIFIED' } }),
        },
        data: { validationStatus: succeeded ? 'VERIFIED' : 'FAILED' },
      });
      await tx.auditLog.create({
        data: {
          action: 'PAYSTACK_CUSTOMER_IDENTIFICATION_RESULT',
          targetType: 'KycVerification',
          targetId: verification.id,
          reference: verification.reference,
          metadata: {
            userId: customer.userId,
            customerCode,
            eventType: normalizedEvent,
            status: nextStatus,
            kycStatusAfter: kycStatus,
            kycTierAfter: kycTier,
            ...(reason ? { reason } : {}),
          },
        },
      });

      if (succeeded) {
        await this.accountNotifications?.bvnVerified(
          tx,
          customer.userId,
          verification.id,
        );
      }
      return {
        received: true,
        processed: true,
        status: nextStatus,
        userId: customer.userId,
        accountSetupConsent:
          succeeded &&
          (this.asJsonRecord(current.checks).accountSetupConsent === true ||
            !!(
              await tx.paystackAccountRequest.findUnique({
                where: { userId: customer.userId },
                select: { consentRecordedAt: true },
              })
            )?.consentRecordedAt),
      };
    });

    if (
      result.processed &&
      result.status === 'VERIFIED' &&
      result.accountSetupConsent
    ) {
      try {
        await this.bankingService.provisionVirtualAccount(result.userId, {
          currency: 'NGN',
          provider: 'paystack',
        } as never);
      } catch (error: unknown) {
        this.logger.warn(
          {
            userId: result.userId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'Paystack KYC is verified; account preparation will need a retry',
        );
      }
    }

    return result;
  }

  async createManualKycDocument(
    userId: string,
    dto: CreateManualKycDocumentDto,
  ) {
    const expectedPrefix = `kyc/${userId}/`;
    if (!dto.objectKey.startsWith(expectedPrefix)) {
      throw new BadRequestException('Document does not belong to this account');
    }
    this.normalizeIdNumber(dto.type, dto.idNumber);

    try {
      const bucket = this.supabaseService
        .getAdminClient()
        .storage.from(this.getKycDocumentBucket());
      const info = await bucket.info(dto.objectKey);
      const metadata = info.data?.metadata as
        | { mimetype?: unknown; size?: unknown }
        | undefined;
      const actualSize =
        typeof info.data?.size === 'number'
          ? info.data.size
          : typeof metadata?.size === 'number'
            ? metadata.size
            : undefined;
      const actualContentType =
        typeof info.data?.contentType === 'string'
          ? info.data.contentType
          : typeof metadata?.mimetype === 'string'
            ? metadata.mimetype
            : undefined;
      if (
        info.error ||
        !info.data ||
        actualSize === undefined ||
        !Number.isFinite(actualSize) ||
        actualSize <= 0 ||
        actualSize > 8 * 1024 * 1024 ||
        !actualContentType ||
        !Object.prototype.hasOwnProperty.call(
          CONTENT_TYPE_EXTENSIONS,
          actualContentType.toLowerCase(),
        )
      ) {
        throw new Error('missing uploaded object');
      }
    } catch {
      throw new BadRequestException(
        'Uploaded identity document could not be found',
      );
    }

    const pending =
      typeof this.prisma.kycDocument.findFirst === 'function'
        ? await this.prisma.kycDocument.findFirst({
            where: {
              userId,
              type: 'NIN',
              status: { in: ['PENDING', 'SUBMITTED', 'VERIFIED'] },
            },
            select: { id: true, status: true },
          })
        : null;
    if (pending?.status === 'VERIFIED') {
      throw new ConflictException('Your NIN is already verified');
    }
    if (pending) {
      throw new ConflictException('A manual NIN review is already in progress');
    }

    const documentId = randomUUID();
    const verificationId = randomUUID();
    const consentRecordedAt = new Date();
    const document = await this.prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`,
        );
      }
      const activeDocument = await tx.kycDocument.findFirst({
        where: {
          userId,
          type: 'NIN',
          status: { in: ['PENDING', 'SUBMITTED', 'VERIFIED'] },
        },
        select: { id: true, status: true },
      });
      if (activeDocument) {
        throw new ConflictException(
          activeDocument.status === 'VERIFIED'
            ? 'Your NIN is already verified'
            : 'A manual NIN review is already in progress',
        );
      }
      const created = await tx.kycDocument.create({
        data: {
          id: documentId,
          userId,
          type: 'NIN',
          documentUrl: dto.objectKey,
          idNumber: this.encryptKycId(dto.idNumber),
          status: 'SUBMITTED',
        },
      });
      await tx.kycVerification.create({
        data: {
          id: verificationId,
          userId,
          documentId,
          provider: 'MANUAL_REVIEW',
          status: 'REVIEW_REQUIRED',
          reference: `manual:${documentId}`,
          checks: {
            manualReviewRequired: true,
            evidenceRequired: 'NIN document ownership and identity match',
            identifierMasked: this.maskIdentifier(dto.idNumber),
          },
          consentRecordedAt,
          consentVersion: 'manual-nin-review-consent-v1',
          consentSource: PROVIDER_CONSENT_SOURCE,
        },
      });
      await tx.user.updateMany({
        where: { id: userId, kycStatus: 'PENDING' },
        data: { kycStatus: 'SUBMITTED' },
      });
      await tx.auditLog.create({
        data: {
          action: 'MANUAL_KYC_DOCUMENT_SUBMITTED',
          targetType: 'KycDocument',
          targetId: documentId,
          reference: `manual:${documentId}`,
          metadata: {
            userId,
            documentType: 'NIN',
            consentVersion: 'manual-nin-review-consent-v1',
            consentRecordedAt: consentRecordedAt.toISOString(),
          },
        },
      });
      return created;
    });

    return {
      ...this.toSafeKycDocument({
        ...document,
        verifications: [
          {
            provider: 'MANUAL_REVIEW',
            status: 'REVIEW_REQUIRED',
            checks: {
              manualReviewRequired: true,
              evidenceRequired: 'NIN document ownership and identity match',
              identifierMasked: this.maskIdentifier(dto.idNumber),
            },
          },
        ],
      }),
      reference: `manual:${documentId}`,
    };
  }

  private async releaseReservedProviderAttempt(input: {
    userId: string;
    documentId: string;
    verificationId: string;
    country: 'NG' | 'GH';
    documentType: KYCType;
    provider: KycProviderResult['provider'];
    validationFingerprint?: string;
    failureMessage?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      if (input.provider === 'PAYSTACK') {
        if (!input.validationFingerprint) return false;

        const current = await tx.kycVerification.findUnique({
          where: { id: input.verificationId },
          select: { status: true, checks: true },
        });
        if (!current || current.status !== 'PENDING') return false;

        const checks = this.asJsonRecord(current.checks);
        const currentFingerprint = this.readProviderString(
          checks,
          'validationFingerprint',
        );
        if (currentFingerprint !== input.validationFingerprint) return false;

        const binding = await tx.paystackCustomer.findUnique({
          where: { userId: input.userId },
          select: { validationStatus: true, validationFingerprint: true },
        });
        if (
          !binding ||
          binding.validationFingerprint !== input.validationFingerprint ||
          binding.validationStatus === 'VERIFIED'
        ) {
          return false;
        }

        const transitioned = await tx.kycVerification.updateMany({
          where: { id: input.verificationId, status: 'PENDING' },
          data: {
            status: 'FAILED',
            errorMessage:
              input.failureMessage ?? PROVIDER_VALIDATION_REJECTED_MESSAGE,
          },
        });
        if (transitioned.count !== 1) return false;

        await tx.kycDocument.updateMany({
          where: {
            id: input.documentId,
            status: { in: ['PENDING', 'SUBMITTED'] },
          },
          data: {
            status: 'REJECTED',
            rejectionNote:
              input.failureMessage ?? PROVIDER_VALIDATION_REJECTED_MESSAGE,
          },
        });
        await tx.paystackCustomer.updateMany({
          where: {
            userId: input.userId,
            validationFingerprint: input.validationFingerprint,
            validationStatus: { not: 'VERIFIED' },
          },
          data: { validationStatus: 'FAILED' },
        });
        await tx.auditLog.create({
          data: {
            action: 'KYC_PROVIDER_FAILURE',
            targetType: 'KycVerification',
            targetId: input.verificationId,
            metadata: {
              userId: input.userId,
              documentId: input.documentId,
              provider: input.provider,
              country: input.country,
              documentType: input.documentType,
              failureClass: 'DEFINITIVE_VALIDATION_REJECTION',
            },
          },
        });
        return true;
      }

      await tx.kycDocument.update({
        where: { id: input.documentId },
        data: {
          status: 'REJECTED',
          rejectionNote: PROVIDER_UNAVAILABLE_MESSAGE,
        },
      });
      await tx.kycVerification.update({
        where: { id: input.verificationId },
        data: {
          status: 'FAILED',
          errorMessage: PROVIDER_UNAVAILABLE_MESSAGE,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'KYC_PROVIDER_FAILURE',
          targetType: 'KycVerification',
          targetId: input.verificationId,
          metadata: {
            userId: input.userId,
            documentId: input.documentId,
            provider: input.provider,
            country: input.country,
            documentType: input.documentType,
          },
        },
      });
      return true;
    });
  }

  async getUserKyc(userId: string) {
    const documents = await this.prisma.kycDocument.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            kycTier: true,
          },
        },
        verifications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            provider: true,
            status: true,
            checks: true,
            consentRecordedAt: true,
          },
        },
      },
    });

    return documents.map((document) => this.toSafeKycDocument(document));
  }

  async getUserKycStatus(userId: string) {
    const [user, documents] = await this.prisma.$transaction([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          isSuspended: true,
          kycStatus: true,
          kycTier: true,
        },
      }),
      this.prisma.kycDocument.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              kycTier: true,
            },
          },
          verifications: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              provider: true,
              status: true,
              reference: true,
              checks: true,
              consentRecordedAt: true,
              errorMessage: true,
              updatedAt: true,
            },
          },
        },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // The active provider owns the automated validation state. Keep this
    // lookup Paystack-only so legacy Monnify status reads remain compatible
    // with their existing query shape and test doubles.
    const providerValidationStatus =
      this.kycProviderGateway.provider === 'PAYSTACK'
        ? ((
            await this.prisma.paystackCustomer.findUnique({
              where: { userId },
              select: { validationStatus: true },
            })
          )?.validationStatus ?? 'UNVERIFIED')
        : undefined;

    const latestDocument = documents[0];
    const latestVerification = latestDocument?.verifications?.[0];

    return {
      provider:
        latestVerification?.provider ?? this.kycProviderGateway.provider,
      ...(this.kycProviderGateway.provider === 'PAYSTACK'
        ? { providerValidationStatus }
        : {}),
      ninVerificationAvailable: this.ninjaProvider?.configured === true,
      accountProvisioning:
        typeof this.bankingService.getAccountProvisioning === 'function'
          ? {
              status: (await this.bankingService.getAccountProvisioning(userId))
                .status,
            }
          : undefined,
      tierOneLimits: new TierOneLimitsService(this.configService).summary(),
      isSuspended: user.isSuspended,
      kycStatus: user.kycStatus,
      kycTier: user.kycTier,
      fullName: user.fullName,
      reference: latestVerification?.reference,
      latestVerification: latestVerification
        ? {
            provider: latestVerification.provider,
            status: latestVerification.status,
            reference: latestVerification.reference,
            errorMessage: latestVerification.errorMessage,
            updatedAt: latestVerification.updatedAt,
          }
        : null,
      documents: documents.map((document) => this.toSafeKycDocument(document)),
    };
  }

  async getAllPendingKyc(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [documents, total] = await this.prisma.$transaction([
      this.prisma.kycDocument.findMany({
        where: { status: { in: ['PENDING', 'SUBMITTED'] } },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              kycStatus: true,
              kycTier: true,
            },
          },
          verifications: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              provider: true,
              status: true,
              checks: true,
              consentRecordedAt: true,
            },
          },
        },
      }),
      this.prisma.kycDocument.count({
        where: { status: { in: ['PENDING', 'SUBMITTED'] } },
      }),
    ]);

    return {
      documents: documents.map((document) => this.toSafeKycDocument(document)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async createAdminDocumentReviewUrl(documentId: string, adminId: string) {
    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        documentUrl: true,
      },
    });

    if (!document) {
      throw new NotFoundException('KYC document not found');
    }

    if (!document.documentUrl) {
      throw new BadRequestException('KYC document file is provider-hosted');
    }

    const documentUrl = await this.createAdminDocumentUrl(document.documentUrl);
    const expiresInSeconds = this.getAdminDocumentUrlTtlSeconds();

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'KYC_DOCUMENT_ACCESS',
        targetType: 'KycDocument',
        targetId: documentId,
        metadata: {
          userId: document.userId,
          type: document.type,
          status: document.status,
          expiresInSeconds,
        },
      },
    });

    this.logger.info({ adminId, documentId }, 'KYC document URL created');

    return {
      documentUrl,
      expiresInSeconds,
    };
  }

  async reviewKyc(documentId: string, dto: ReviewKycDto, adminId: string) {
    if (!dto.rejectionNote?.trim()) {
      throw new BadRequestException('Review reason is required');
    }

    const rejectionNote = dto.rejectionNote.trim();

    const owner = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      select: { userId: true },
    });
    if (!owner) {
      throw new NotFoundException('KYC document not found');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // Use the same user-first lock order as provider finalization. Decisions
      // for different documents must read the current tier after waiting.
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${owner.userId} FOR UPDATE`,
        );
      }
      const document = await tx.kycDocument.findUnique({
        where: { id: documentId },
        include: { user: true, verifications: { select: { provider: true } } },
      });
      if (!document) throw new NotFoundException('KYC document not found');
      if (
        document.verifications?.some(({ provider }) => provider === 'PAYSTACK')
      ) {
        throw new BadRequestException(
          'Paystack identity verification is finalized by provider evidence and cannot be manually reviewed',
        );
      }
      if (
        dto.status === 'VERIFIED' &&
        document.verifications?.some(({ provider }) => provider === 'NINJA')
      ) {
        throw new BadRequestException(
          'An automated NIN check requires provider confirmation. Reject the inconclusive check before requesting manual evidence.',
        );
      }
      if (document.status !== 'PENDING' && document.status !== 'SUBMITTED') {
        throw new BadRequestException('Document already reviewed');
      }
      const reviewed = await tx.kycDocument.update({
        where: { id: documentId, status: { in: ['PENDING', 'SUBMITTED'] } },
        data: {
          status: dto.status,
          rejectionNote,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      });

      await tx.kycVerification.updateMany({
        where: {
          documentId,
          status: { in: ['PENDING', 'REVIEW_REQUIRED'] },
        },
        data: {
          status: dto.status === 'VERIFIED' ? 'VERIFIED' : 'REJECTED',
          errorMessage: dto.status === 'REJECTED' ? rejectionNote : null,
        },
      });

      const kycTier =
        dto.status === 'VERIFIED'
          ? await this.resolvePromotedKycTier(
              tx,
              document.userId,
              document.type,
              document.user.kycTier,
            )
          : document.user.kycTier;
      const kycStatus =
        dto.status === 'VERIFIED' ||
        document.user.kycStatus === 'VERIFIED' ||
        document.user.kycTier !== 'TIER_0'
          ? 'VERIFIED'
          : 'REJECTED';

      await tx.user.update({
        where: { id: document.userId },
        data: { kycStatus, kycTier },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'KYC_REVIEW',
          targetType: 'KycDocument',
          targetId: documentId,
          reason: rejectionNote,
          before: this.toAuditKycDocument(document),
          after: this.toAuditKycDocument(reviewed),
          metadata: {
            userId: document.userId,
            status: kycStatus,
            reviewedStatus: dto.status,
            type: document.type,
            kycTierBefore: document.user.kycTier,
            kycTierAfter: kycTier,
          },
        },
      });

      return reviewed;
    });

    this.logger.info(
      { adminId, documentId, status: dto.status },
      'KYC document reviewed',
    );

    return this.toSafeKycDocument(updated);
  }

  async createDispute(userId: string, dto: CreateDisputeDto) {
    if (dto.transactionId) {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: dto.transactionId },
      });

      if (!tx) {
        throw new NotFoundException('Transaction not found');
      }

      if (tx.userId !== userId) {
        throw new BadRequestException('Transaction does not belong to user');
      }
    }

    const dispute = await this.prisma.dispute.create({
      data: {
        userId,
        transactionId: dto.transactionId || null,
        type: dto.type,
        description: dto.description,
      },
    });

    this.logger.info({ userId, disputeId: dispute.id }, 'Dispute created');

    return dispute;
  }

  async getUserDisputes(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [disputes, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          transaction: {
            select: {
              id: true,
              type: true,
              amount: true,
              currency: true,
              reference: true,
            },
          },
        },
      }),
      this.prisma.dispute.count({ where: { userId } }),
    ]);

    return {
      disputes,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAllDisputes(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [disputes, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
            },
          },
          transaction: {
            select: {
              id: true,
              type: true,
              amount: true,
              reference: true,
            },
          },
        },
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return {
      disputes,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async resolveDispute(
    disputeId: string,
    dto: ResolveDisputeDto,
    adminId: string,
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    const resolved = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: dto.status as DisputeStatus,
        resolution: dto.resolution || null,
        resolvedBy: adminId,
        resolvedAt: new Date(),
      },
    });

    this.logger.info(
      { adminId, disputeId, status: dto.status },
      'Dispute resolved',
    );

    return resolved;
  }

  private assertPaystackIdentityInput(dto: CreateIdentityVerificationDto) {
    if (dto.type !== 'BVN') {
      throw new BadRequestException(
        'Paystack automated verification supports BVN with a Nigerian bank account',
      );
    }
    if (!dto.bankCode || !dto.accountNumber) {
      throw new BadRequestException(
        'Bank code and account number are required for Paystack BVN verification',
      );
    }
  }

  private buildPaystackValidationFingerprint(input: {
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

  private readProviderString(
    value: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const candidate = value[key];
    return typeof candidate === 'string' && candidate.trim()
      ? candidate.trim()
      : undefined;
  }

  private asJsonRecord(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {} as Record<string, unknown>;
    }
    return value as Record<string, unknown>;
  }

  private normalizeIdNumber(type: string, idNumber: string) {
    const normalized = idNumber.trim().toUpperCase().replace(/\s+/g, '');

    if (type === 'BVN' && !/^\d{11}$/.test(normalized)) {
      throw new BadRequestException('BVN must be 11 digits');
    }

    if (type === 'NIN' && !/^\d{11}$/.test(normalized)) {
      throw new BadRequestException('NIN must be 11 digits');
    }

    if (
      ['PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD'].includes(type) &&
      !/^[A-Z0-9-]{5,32}$/.test(normalized)
    ) {
      throw new BadRequestException(
        'ID number can contain letters, numbers, and hyphen only',
      );
    }

    return normalized;
  }

  private assertValidDateOfBirth(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      throw new BadRequestException('Date of birth must use YYYY-MM-DD');
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const isExactDate =
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day;
    if (!isExactDate || parsed.getTime() > Date.now()) {
      throw new BadRequestException('Date of birth must be a valid past date');
    }
  }

  private assertSupportedIdentityType(country: 'NG' | 'GH', type: KYCType) {
    if (country !== 'NG' || !['BVN', 'NIN'].includes(type)) {
      throw new BadRequestException(
        'Identity type is not supported for the selected country',
      );
    }
  }

  private toNameValidation(fullName?: string | null) {
    const names = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (names.length === 0) return undefined;

    return {
      firstName: names[0],
      ...(names.length > 1 ? { lastName: names[names.length - 1] } : {}),
    };
  }

  private resolveDocumentStatus(status: string) {
    if (status === 'VERIFIED') return 'VERIFIED';
    if (status === 'REJECTED' || status === 'FAILED') return 'REJECTED';
    return 'SUBMITTED';
  }

  private getKycDocumentBucket() {
    return (
      this.configService.get<string>('KYC_DOCUMENT_BUCKET') ||
      DEFAULT_KYC_DOCUMENT_BUCKET
    );
  }

  private getAdminDocumentUrlTtlSeconds() {
    return (
      this.configService.get<number>('KYC_ADMIN_DOCUMENT_URL_TTL_SECONDS') ||
      DEFAULT_ADMIN_DOCUMENT_URL_TTL_SECONDS
    );
  }

  private async createAdminDocumentUrl(objectKey: string) {
    if (objectKey.startsWith('https://')) {
      return objectKey;
    }

    return this.supabaseService.createSignedReadUrl(
      this.getKycDocumentBucket(),
      objectKey,
      this.getAdminDocumentUrlTtlSeconds(),
    );
  }

  private encryptKycId(idNumber: string) {
    return `enc:v1:${encryptSensitiveValue(
      idNumber,
      this.configService.get<string>('PII_ENCRYPTION_KEY'),
    )}`;
  }

  private maskStoredKycId(idNumber?: string | null) {
    if (!idNumber) {
      return null;
    }

    const rawValue = this.decryptStoredKycId(idNumber);
    return this.maskIdentifier(rawValue);
  }

  private decryptStoredKycId(idNumber: string) {
    if (!idNumber.startsWith('enc:v1:')) {
      return idNumber;
    }

    return decryptSensitiveValue(
      idNumber.slice('enc:v1:'.length),
      this.configService.get<string>('PII_ENCRYPTION_KEY'),
    );
  }

  private toSafeKycDocument<
    T extends {
      id?: string;
      type?: string;
      createdAt?: Date;
      idNumber?: string | null;
      documentUrl?: string | null;
      kycTier?: KYCTier | null;
      user?: { kycTier?: KYCTier | null };
      verifications?: Array<{
        provider: string;
        status: string;
        checks?: Prisma.JsonValue | Prisma.InputJsonValue | null;
        consentRecordedAt?: Date | null;
      }>;
    },
  >(document: T, options: { includeDocumentUrl?: boolean } = {}) {
    const safeDocument = { ...document };

    if (!options.includeDocumentUrl) {
      delete safeDocument.documentUrl;
    }

    delete safeDocument.verifications;

    const latestVerification = document.verifications?.[0];
    const checks =
      latestVerification?.checks &&
      typeof latestVerification.checks === 'object' &&
      !Array.isArray(latestVerification.checks)
        ? (latestVerification.checks as Record<string, unknown>)
        : undefined;

    return {
      ...safeDocument,
      idNumber: this.maskStoredKycId(document.idNumber),
      kycTier: document.kycTier ?? document.user?.kycTier,
      provider: latestVerification?.provider,
      verificationStatus: latestVerification?.status,
      providerStatus: latestVerification?.status,
      ...(document.type === 'BVN' &&
      latestVerification?.provider === 'PAYSTACK' &&
      latestVerification.status === 'PENDING' &&
      document.id
        ? {
            recovery: toPaystackRecoveryView(
              document.id,
              latestVerification.consentRecordedAt ?? document.createdAt,
              checks?.paystackRecovery,
            ),
          }
        : {}),
      manualReviewRequired:
        latestVerification?.provider === 'MANUAL_REVIEW' ||
        checks?.manualReviewRequired === true ||
        checks?.reviewRequired === true ||
        latestVerification?.status === 'REVIEW_REQUIRED',
      manualReviewStatus:
        latestVerification?.provider === 'MANUAL_REVIEW'
          ? latestVerification.status
          : undefined,
      reviewSource: document.documentUrl
        ? ('DOCUMENT' as const)
        : latestVerification
          ? ('PROVIDER' as const)
          : ('NONE' as const),
      reviewEvidence: latestVerification
        ? this.toSafeReviewEvidence(latestVerification, checks)
        : undefined,
    };
  }

  private toSafeReviewEvidence(
    verification: { provider: string; status: string },
    checks?: Record<string, unknown>,
  ) {
    const evidence: Record<string, unknown> = {
      provider: verification.provider,
      status: verification.status,
    };
    for (const key of SAFE_KYC_REVIEW_CHECK_KEYS) {
      const value = checks?.[key];
      if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'number'
      ) {
        evidence[key] = value;
      }
    }
    return evidence;
  }

  private toAuditKycDocument(document: {
    id: string;
    userId: string;
    type: string;
    idNumber?: string | null;
    status: string;
    rejectionNote?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: Date | null;
  }) {
    return {
      id: document.id,
      userId: document.userId,
      type: document.type,
      idNumber: this.maskStoredKycId(document.idNumber),
      status: document.status,
      rejectionNote: document.rejectionNote,
      reviewedBy: document.reviewedBy,
      reviewedAt: document.reviewedAt?.toISOString() ?? null,
    };
  }

  private maskIdentifier(value: string) {
    if (value.length <= 4) {
      return '*'.repeat(value.length);
    }

    return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002') ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002')
    );
  }

  private async resolvePromotedKycTier(
    tx: Prisma.TransactionClient,
    userId: string,
    reviewedType: KYCType,
    currentTier: KYCTier = 'TIER_0',
  ) {
    const verifiedDocuments = await tx.kycDocument.findMany({
      where: {
        userId,
        status: 'VERIFIED',
        type: { in: ['BVN', 'NIN', 'GHANA_CARD', 'PASSPORT', 'VOTERS_CARD'] },
      },
      select: { type: true },
    });
    const verifiedTypes = new Set<KYCType>([
      reviewedType,
      ...verifiedDocuments.map((document) => document.type),
    ]);

    let eligibleTier: KYCTier =
      verifiedTypes.has('BVN') && verifiedTypes.has('NIN')
        ? 'TIER_2'
        : verifiedTypes.has('BVN')
          ? 'TIER_1'
          : 'TIER_0';
    if (!verifiedTypes.has('BVN') && !['NIN', 'BVN'].includes(reviewedType)) {
      const owner = await tx.user.findUnique({
        where: { id: userId },
        select: { country: true },
      });
      // Historical Ghana identity routes keep their rules only when the
      // authoritative customer country establishes that identity context.
      if (owner?.country?.toUpperCase() === 'GH') {
        eligibleTier =
          verifiedTypes.has('GHANA_CARD') ||
          (verifiedTypes.has('PASSPORT') && verifiedTypes.has('VOTERS_CARD'))
            ? 'TIER_2'
            : ['PASSPORT', 'VOTERS_CARD', 'DRIVERS_LICENSE'].some((type) =>
                  verifiedTypes.has(type as KYCType),
                )
              ? 'TIER_1'
              : 'TIER_0';
      }
    }

    return this.maxKycTier(currentTier, eligibleTier);
  }

  private maxKycTier(currentTier: KYCTier, eligibleTier: KYCTier) {
    const tierRank: Record<KYCTier, number> = {
      TIER_0: 0,
      TIER_1: 1,
      TIER_2: 2,
      TIER_3: 3,
    };

    return tierRank[eligibleTier] > tierRank[currentTier]
      ? eligibleTier
      : currentTier;
  }
}
