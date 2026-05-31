import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateKycUploadDto,
  SubmitKycDto,
  ReviewKycDto,
  CreateDisputeDto,
  ResolveDisputeDto,
} from "./dto/kyc.dto";
import { PinoLogger } from "nestjs-pino";
import { DisputeStatus } from "@prisma/client";
import { SupabaseService } from "../supabase/supabase.service";
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from "../common/utils/encryption";
import { KYC_PROVIDER_GATEWAY } from "./providers/kyc-provider.gateway";
import type { KycProviderGateway } from "./providers/kyc-provider.gateway";
import { KYCTier, KYCType, Prisma } from "@prisma/client";

const DEFAULT_KYC_DOCUMENT_BUCKET = "kyc-documents";
const DEFAULT_ADMIN_DOCUMENT_URL_TTL_SECONDS = 300;
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
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
  ) {}

  async createDocumentUploadUrl(userId: string, dto: CreateKycUploadDto) {
    const extension = CONTENT_TYPE_EXTENSIONS[dto.contentType];

    if (!extension) {
      throw new BadRequestException("Unsupported document file type");
    }

    const objectKey = `kyc/${userId}/${Date.now()}-${randomUUID()}${extension}`;
    const bucket = this.getKycDocumentBucket();
    const signedUpload = await this.supabaseService.createSignedUploadUrl(
      bucket,
      objectKey,
    );

    this.logger.info({ userId, objectKey }, "KYC upload URL created");

    return {
      bucket,
      objectKey,
      token: signedUpload.token,
      signedUrl: signedUpload.signedUrl,
      expiresInSeconds: 7200,
    };
  }

  async submitKyc(userId: string, dto: SubmitKycDto) {
    const normalizedIdNumber = this.normalizeIdNumber(dto.type, dto.idNumber);
    this.assertUserOwnsDocumentObjectKey(userId, dto.documentObjectKey);

    const [existing, user] = await this.prisma.$transaction([
      this.prisma.kycDocument.findFirst({
        where: { userId, status: { in: ["PENDING", "SUBMITTED"] } },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { kycStatus: true, kycTier: true },
      }),
    ]);

    if (existing) {
      throw new BadRequestException(
        "You already have a pending KYC submission",
      );
    }

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const documentId = randomUUID();
    const encryptedIdNumber = this.encryptKycId(normalizedIdNumber);
    const providerResult = await this.kycProviderGateway.submitVerification({
      userId,
      documentId,
      type: dto.type,
      identifierMasked: this.maskIdentifier(normalizedIdNumber),
    });

    const document = await this.prisma.$transaction(async (tx) => {
      const submitted = await tx.kycDocument.create({
        data: {
          id: documentId,
          userId,
          type: dto.type,
          documentUrl: dto.documentObjectKey,
          idNumber: encryptedIdNumber,
          status: "SUBMITTED",
        },
      });

      await tx.kycVerification.create({
        data: {
          userId,
          documentId: submitted.id,
          provider: providerResult.provider,
          status: providerResult.status,
          reference: providerResult.reference,
          checks: providerResult.checks,
          responseHash: providerResult.responseHash,
          errorMessage: providerResult.errorMessage,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          kycStatus: user.kycStatus === "VERIFIED" ? "VERIFIED" : "SUBMITTED",
        },
      });

      return submitted;
    });

    this.logger.info(
      { userId, kycId: document.id, type: document.type },
      "KYC document submitted",
    );

    return this.toSafeKycDocument({
      ...document,
      kycTier: user.kycTier,
      verifications: [
        {
          provider: providerResult.provider,
          status: providerResult.status,
          checks: providerResult.checks,
        },
      ],
    });
  }

  async getUserKyc(userId: string) {
    const documents = await this.prisma.kycDocument.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            kycTier: true,
          },
        },
        verifications: {
          orderBy: { createdAt: "desc" },
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

  async getAllPendingKyc(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [documents, total] = await this.prisma.$transaction([
      this.prisma.kycDocument.findMany({
        where: { status: { in: ["PENDING", "SUBMITTED"] } },
        skip,
        take: limit,
        orderBy: { createdAt: "asc" },
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
            orderBy: { createdAt: "desc" },
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
        where: { status: { in: ["PENDING", "SUBMITTED"] } },
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
      throw new NotFoundException("KYC document not found");
    }

    const documentUrl = await this.createAdminDocumentUrl(document.documentUrl);
    const expiresInSeconds = this.getAdminDocumentUrlTtlSeconds();

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: "KYC_DOCUMENT_ACCESS",
        targetType: "KycDocument",
        targetId: documentId,
        metadata: {
          userId: document.userId,
          type: document.type,
          status: document.status,
          expiresInSeconds,
        },
      },
    });

    this.logger.info({ adminId, documentId }, "KYC document URL created");

    return {
      documentUrl,
      expiresInSeconds,
    };
  }

  async reviewKyc(documentId: string, dto: ReviewKycDto, adminId: string) {
    if (!dto.rejectionNote?.trim()) {
      throw new BadRequestException("Review reason is required");
    }

    const rejectionNote = dto.rejectionNote.trim();

    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      include: { user: true },
    });

    if (!document) {
      throw new NotFoundException("KYC document not found");
    }

    if (document.status === "VERIFIED" || document.status === "REJECTED") {
      throw new BadRequestException("Document already reviewed");
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
          status: { in: ["PENDING", "REVIEW_REQUIRED"] },
        },
        data: {
          status: dto.status === "VERIFIED" ? "VERIFIED" : "REJECTED",
          errorMessage: dto.status === "REJECTED" ? rejectionNote : null,
        },
      });

      const kycTier =
        dto.status === "VERIFIED"
          ? await this.resolvePromotedKycTier(
              tx,
              document.userId,
              document.type,
              document.user.kycTier,
            )
          : document.user.kycTier;
      const kycStatus =
        dto.status === "VERIFIED" ||
        document.user.kycStatus === "VERIFIED" ||
        document.user.kycTier !== "TIER_0"
          ? "VERIFIED"
          : "REJECTED";

      await tx.user.update({
        where: { id: document.userId },
        data: { kycStatus, kycTier },
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: "KYC_REVIEW",
          targetType: "KycDocument",
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
      "KYC document reviewed",
    );

    return this.toSafeKycDocument(updated);
  }

  async createDispute(userId: string, dto: CreateDisputeDto) {
    if (dto.transactionId) {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: dto.transactionId },
      });

      if (!tx) {
        throw new NotFoundException("Transaction not found");
      }

      if (tx.userId !== userId) {
        throw new BadRequestException("Transaction does not belong to user");
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

    this.logger.info({ userId, disputeId: dispute.id }, "Dispute created");

    return dispute;
  }

  async getUserDisputes(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [disputes, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
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
        orderBy: { createdAt: "desc" },
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
      throw new NotFoundException("Dispute not found");
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
      "Dispute resolved",
    );

    return resolved;
  }

  private normalizeIdNumber(type: string, idNumber: string) {
    const normalized = idNumber.trim().toUpperCase().replace(/\s+/g, "");

    if (type === "BVN" && !/^\d{11}$/.test(normalized)) {
      throw new BadRequestException("BVN must be 11 digits");
    }

    if (type === "NIN" && !/^\d{11}$/.test(normalized)) {
      throw new BadRequestException("NIN must be 11 digits");
    }

    if (
      ["PASSPORT", "DRIVERS_LICENSE", "VOTERS_CARD"].includes(type) &&
      !/^[A-Z0-9-]{5,32}$/.test(normalized)
    ) {
      throw new BadRequestException(
        "ID number can contain letters, numbers, and hyphen only",
      );
    }

    return normalized;
  }

  private assertUserOwnsDocumentObjectKey(userId: string, objectKey: string) {
    const expectedPrefix = `kyc/${userId}/`;

    if (!objectKey.startsWith(expectedPrefix)) {
      throw new BadRequestException("Document upload does not belong to user");
    }
  }

  private getKycDocumentBucket() {
    return (
      this.configService.get<string>("KYC_DOCUMENT_BUCKET") ||
      DEFAULT_KYC_DOCUMENT_BUCKET
    );
  }

  private getAdminDocumentUrlTtlSeconds() {
    return (
      this.configService.get<number>("KYC_ADMIN_DOCUMENT_URL_TTL_SECONDS") ||
      DEFAULT_ADMIN_DOCUMENT_URL_TTL_SECONDS
    );
  }

  private async createAdminDocumentUrl(objectKey: string) {
    if (objectKey.startsWith("https://")) {
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
      this.configService.get<string>("PII_ENCRYPTION_KEY"),
    )}`;
  }

  private maskStoredKycId(idNumber: string) {
    const rawValue = this.decryptStoredKycId(idNumber);
    return this.maskIdentifier(rawValue);
  }

  private decryptStoredKycId(idNumber: string) {
    if (!idNumber.startsWith("enc:v1:")) {
      return idNumber;
    }

    return decryptSensitiveValue(
      idNumber.slice("enc:v1:".length),
      this.configService.get<string>("PII_ENCRYPTION_KEY"),
    );
  }

  private toSafeKycDocument<
    T extends {
      idNumber: string;
      documentUrl?: string;
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
      typeof latestVerification.checks === "object" &&
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
        latestVerification?.provider === "MANUAL_REVIEW" ||
        checks?.manualReviewRequired === true,
      manualReviewStatus:
        latestVerification?.provider === "MANUAL_REVIEW"
          ? latestVerification.status
          : undefined,
    };
  }

  private toAuditKycDocument(document: {
    id: string;
    userId: string;
    type: string;
    idNumber: string;
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
      return "*".repeat(value.length);
    }

    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  }

  private async resolvePromotedKycTier(
    tx: Prisma.TransactionClient,
    userId: string,
    reviewedType: KYCType,
    currentTier: KYCTier = "TIER_0",
  ) {
    const verifiedDocuments = await tx.kycDocument.findMany({
      where: {
        userId,
        status: "VERIFIED",
        type: { in: ["BVN", "NIN"] },
      },
      select: { type: true },
    });
    const verifiedTypes = new Set<KYCType>([
      reviewedType,
      ...verifiedDocuments.map((document) => document.type),
    ]);

    const eligibleTier =
      verifiedTypes.has("BVN") && verifiedTypes.has("NIN")
        ? "TIER_2"
        : verifiedTypes.has("BVN") || verifiedTypes.has("NIN")
          ? "TIER_1"
          : "TIER_0";

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
