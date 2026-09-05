import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateKycUploadDto,
  ReviewKycDto,
  CreateDisputeDto,
  ResolveDisputeDto,
  CreateIdentityVerificationDto,
} from './dto/kyc.dto';
import { PinoLogger } from 'nestjs-pino';
import { DisputeStatus } from '@prisma/client';
import { SupabaseService } from '../supabase/supabase.service';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '../common/utils/encryption';
import { KYC_PROVIDER_GATEWAY } from './providers/kyc-provider.gateway';
import type {
  KycProviderCallbackResult,
  KycProviderGateway,
  KycProviderResult,
} from './providers/kyc-provider.gateway';
import { KYCTier, KYCType, Prisma } from '@prisma/client';
import { KycWebhookInboxService } from './kyc-webhook-inbox.service';
import { YouverifyProvider } from './providers/youverify.provider';

const DEFAULT_KYC_DOCUMENT_BUCKET = 'kyc-documents';
const DEFAULT_ADMIN_DOCUMENT_URL_TTL_SECONDS = 300;
const PROVIDER_CONSENT_SOURCE = 'WEB_OR_MOBILE';
const PROVIDER_UNAVAILABLE_MESSAGE =
  'Identity verification is temporarily unavailable';
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
    private readonly youverifyProvider: YouverifyProvider,
    private readonly kycWebhookInbox: KycWebhookInboxService,
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
    const provider = this.kycProviderGateway.provider;
    this.assertSupportedIdentityType(dto.country, dto.type, provider);
    this.assertValidDateOfBirth(dto.dateOfBirth);
    const normalizedIdNumber = this.normalizeIdNumber(dto.type, dto.idNumber);
    const documentId = randomUUID();
    const verificationId = randomUUID();
    const consentRecordedAt = new Date();
    const consentVersion =
      provider === 'NINJA'
        ? 'ninja-direct-verify-consent-v1'
        : 'youverify-subject-consent-v1';

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
            kycStatus: true,
            kycTier: true,
          },
        });
        if (!user) {
          throw new NotFoundException('User not found');
        }
        if (provider === 'NINJA') {
          const nameValidation = this.toNameValidation(user.fullName);
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
      providerResult = await this.kycProviderGateway.verifyIdentity({
        userId,
        documentId,
        country: dto.country,
        type: dto.type,
        identifier: normalizedIdNumber,
        identifierMasked: this.maskIdentifier(normalizedIdNumber),
        consentAccepted: dto.consentAccepted,
        validation: {
          ...this.toNameValidation(
            [dto.firstName, dto.lastName].filter(Boolean).join(' ') ||
              reservation.user.fullName,
          ),
          dateOfBirth: dto.dateOfBirth,
        },
      });
      if (providerResult.provider !== provider) {
        throw new BadRequestException('Unexpected identity provider response');
      }
    } catch (error: unknown) {
      await this.releaseReservedProviderAttempt({
        userId,
        documentId,
        verificationId,
        country: dto.country,
        documentType: dto.type,
        provider,
      });
      this.logger.warn(
        { userId, documentId, country: dto.country, documentType: dto.type },
        'KYC attempt released after provider failure',
      );
      throw error;
    }

    const result = await this.prisma.$transaction(async (tx) => {
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
          checks: providerResult.checks,
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
              reservation.user.kycTier,
            )
          : reservation.user.kycTier;
      const kycStatus =
        providerResult.status === 'VERIFIED' ||
        reservation.user.kycStatus === 'VERIFIED'
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

      return {
        document: {
          ...reservation.document,
          status: documentStatus,
          rejectionNote: providerResult.errorMessage ?? null,
        },
        kycTier,
      };
    });

    this.logger.info(
      {
        userId,
        documentId: result.document.id,
        reference: providerResult.reference,
        status: providerResult.status,
      },
      'KYC provider result stored',
    );

    return {
      ...this.toSafeKycDocument({
        ...result.document,
        kycTier: result.kycTier,
        verifications: [
          {
            provider: providerResult.provider,
            status: providerResult.status,
            checks: providerResult.checks,
          },
        ],
      }),
      reference: providerResult.reference,
    };
  }

  async verifyWithYouverify(
    userId: string,
    dto: CreateIdentityVerificationDto,
  ) {
    return this.verifyIdentity(userId, dto);
  }

  private async releaseReservedProviderAttempt(input: {
    userId: string;
    documentId: string;
    verificationId: string;
    country: 'NG' | 'GH';
    documentType: KYCType;
    provider: KycProviderResult['provider'];
  }) {
    await this.prisma.$transaction(async (tx) => {
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
    });
  }

  async processYouverifyCallback(input: {
    body: Record<string, unknown>;
    rawBody?: Buffer | string;
    signatureHeader?: string;
  }) {
    if (
      !this.youverifyProvider.verifyCallbackSignature({
        rawBody: input.rawBody,
        signature: input.signatureHeader,
      })
    ) {
      throw new BadRequestException('Invalid Youverify webhook signature');
    }

    const providerResult = this.youverifyProvider.normalizeCallback(input.body);
    if (providerResult.provider !== 'YOUVERIFY') {
      throw new BadRequestException('Unexpected KYC webhook provider');
    }

    const eventType = input.body.event;
    if (typeof eventType !== 'string' || !eventType.trim()) {
      throw new BadRequestException('Youverify webhook event is required');
    }
    const accepted = await this.kycWebhookInbox.accept({
      eventType: eventType.trim(),
      result: providerResult,
    });

    return { received: true, ...accepted };
  }

  async applyYouverifyCallback(providerResult: KycProviderCallbackResult) {
    if (providerResult.provider !== 'YOUVERIFY') {
      throw new BadRequestException('Unexpected KYC webhook provider');
    }

    const existing = await this.prisma.kycVerification.findUnique({
      where: {
        provider_reference: {
          provider: providerResult.provider,
          reference: providerResult.reference,
        },
      },
      include: {
        document: {
          include: {
            user: {
              select: {
                kycStatus: true,
                kycTier: true,
              },
            },
          },
        },
      },
    });
    if (!existing) {
      throw new BadRequestException('Unknown Youverify verification reference');
    }

    if (existing.responseHash === providerResult.responseHash) {
      return {
        duplicate: true,
        status: existing.status,
      };
    }

    const terminalStatuses = ['VERIFIED', 'REJECTED'];
    if (terminalStatuses.includes(existing.status)) {
      return {
        duplicate: false,
        ignored: true,
        status: existing.status,
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.kycVerification.updateMany({
        where: {
          id: existing.id,
          status: { notIn: ['VERIFIED', 'REJECTED'] },
        },
        data: {
          status: providerResult.status,
          checks: providerResult.checks,
          responseHash: providerResult.responseHash,
          errorMessage: providerResult.errorMessage ?? null,
        },
      });
      if (claimed.count === 0) return null;

      const documentStatus = this.resolveDocumentStatus(providerResult.status);
      const kycTier =
        providerResult.status === 'VERIFIED'
          ? await this.resolvePromotedKycTier(
              tx,
              existing.userId,
              existing.document.type,
              existing.document.user.kycTier,
            )
          : existing.document.user.kycTier;
      const kycStatus =
        providerResult.status === 'VERIFIED' ||
        existing.document.user.kycStatus === 'VERIFIED'
          ? ('VERIFIED' as const)
          : providerResult.status === 'REJECTED'
            ? ('REJECTED' as const)
            : ('SUBMITTED' as const);

      const reviewed = await tx.kycDocument.update({
        where: { id: existing.documentId },
        data: {
          status: documentStatus,
          rejectionNote:
            providerResult.status === 'REJECTED' ||
            providerResult.status === 'FAILED'
              ? providerResult.errorMessage
              : null,
        },
      });
      await tx.user.update({
        where: { id: existing.userId },
        data: { kycStatus, kycTier },
      });
      await tx.auditLog.create({
        data: {
          action: 'KYC_YOUVERIFY_WEBHOOK',
          targetType: 'KycVerification',
          targetId: existing.id,
          reference: providerResult.reference,
          metadata: {
            userId: existing.userId,
            documentId: existing.documentId,
            provider: providerResult.provider,
            verificationStatus: providerResult.status,
            documentStatus,
            kycStatusAfter: kycStatus,
            kycTierAfter: kycTier,
            responseHash: providerResult.responseHash,
          },
        },
      });

      return { reviewed, kycStatus, kycTier };
    });

    if (!updated) {
      const current = await this.prisma.kycVerification.findUnique({
        where: { id: existing.id },
        select: { status: true },
      });
      return {
        duplicate: false,
        ignored: true,
        status: current?.status ?? existing.status,
      };
    }

    this.logger.info(
      {
        userId: existing.userId,
        documentId: existing.documentId,
        reference: providerResult.reference,
        status: providerResult.status,
      },
      'Youverify KYC webhook processed',
    );

    return {
      duplicate: false,
      status: providerResult.status,
      documentStatus: updated.reviewed.status,
      kycStatus: updated.kycStatus,
      kycTier: updated.kycTier,
    };
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

    const latestDocument = documents[0];
    const latestVerification = latestDocument?.verifications?.[0];

    return {
      provider:
        latestVerification?.provider ?? this.kycProviderGateway.provider,
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

    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      include: { user: true },
    });

    if (!document) {
      throw new NotFoundException('KYC document not found');
    }

    if (document.status === 'VERIFIED' || document.status === 'REJECTED') {
      throw new BadRequestException('Document already reviewed');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const reviewed = await tx.kycDocument.update({
        where: { id: documentId },
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

  private assertSupportedIdentityType(
    country: 'NG' | 'GH',
    type: KYCType,
    provider: KycProviderResult['provider'],
  ) {
    if (provider === 'NINJA') {
      if (country !== 'NG' || !['BVN', 'NIN'].includes(type)) {
        throw new BadRequestException(
          'Identity type is not supported for the selected country',
        );
      }
      return;
    }
    const supportedTypes: Record<'NG' | 'GH', KYCType[]> = {
      NG: ['BVN', 'NIN', 'DRIVERS_LICENSE', 'VOTERS_CARD'],
      GH: ['PASSPORT', 'VOTERS_CARD'],
    };
    if (!supportedTypes[country].includes(type)) {
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
      idNumber?: string | null;
      documentUrl?: string | null;
      kycTier?: KYCTier | null;
      user?: { kycTier?: KYCTier | null };
      verifications?: Array<{
        provider: string;
        status: string;
        checks?: Prisma.JsonValue | Prisma.InputJsonValue | null;
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
        type: { in: ['BVN', 'NIN', 'PASSPORT', 'VOTERS_CARD'] },
      },
      select: { type: true },
    });
    const verifiedTypes = new Set<KYCType>([
      reviewedType,
      ...verifiedDocuments.map((document) => document.type),
    ]);

    const eligibleTier = verifiedTypes.has('GHANA_CARD')
      ? 'TIER_2'
      : verifiedTypes.has('BVN') && verifiedTypes.has('NIN')
        ? 'TIER_2'
        : verifiedTypes.has('PASSPORT') && verifiedTypes.has('VOTERS_CARD')
          ? 'TIER_2'
          : verifiedTypes.has('BVN') || verifiedTypes.has('NIN')
            ? 'TIER_1'
            : verifiedTypes.has('PASSPORT') ||
                verifiedTypes.has('DRIVERS_LICENSE') ||
                verifiedTypes.has('VOTERS_CARD')
              ? 'TIER_1'
              : 'TIER_0';

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
