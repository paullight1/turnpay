import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SubmitKycDto,
  ReviewKycDto,
  CreateDisputeDto,
  ResolveDisputeDto,
} from './dto/kyc.dto';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async submitKyc(userId: string, dto: SubmitKycDto) {
    const existing = await this.prisma.kycDocument.findFirst({
      where: { userId, status: { in: ['PENDING', 'SUBMITTED'] } },
    });

    if (existing) {
      throw new BadRequestException(
        'You already have a pending KYC submission',
      );
    }

    const document = await this.prisma.kycDocument.create({
      data: {
        userId,
        type: dto.type,
        documentUrl: dto.documentUrl,
        idNumber: dto.idNumber,
        status: 'SUBMITTED',
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'SUBMITTED' },
    });

    this.logger.info({ userId, kycId: document.id }, 'KYC document submitted');

    return document;
  }

  async getUserKyc(userId: string) {
    return this.prisma.kycDocument.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
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
            },
          },
        },
      }),
      this.prisma.kycDocument.count({
        where: { status: { in: ['PENDING', 'SUBMITTED'] } },
      }),
    ]);

    return {
      documents,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async reviewKyc(documentId: string, dto: ReviewKycDto, adminId: string) {
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

    const updated = await this.prisma.kycDocument.update({
      where: { id: documentId },
      data: {
        status: dto.status,
        rejectionNote: dto.rejectionNote || null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    await this.prisma.user.update({
      where: { id: document.userId },
      data: { kycStatus: dto.status },
    });

    this.logger.info(
      { adminId, documentId, status: dto.status },
      'KYC document reviewed',
    );

    return updated;
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
        status: dto.status as any,
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
}
