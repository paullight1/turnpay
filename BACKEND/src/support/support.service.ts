import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSupportTicketDto,
  ResolveSupportTicketDto,
  SupportTicketStatus,
} from './dto/support.dto';

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async createTicket(userId: string, dto: CreateSupportTicketDto) {
    if (dto.transactionId && dto.transactionReference) {
      throw new BadRequestException(
        'Provide either transactionId or transactionReference, not both',
      );
    }

    let transactionId: string | null = null;

    if (dto.transactionId || dto.transactionReference) {
      const transaction = await this.prisma.transaction.findUnique({
        where: dto.transactionId
          ? { id: dto.transactionId }
          : { reference: dto.transactionReference },
        select: { id: true, userId: true },
      });

      if (!transaction || transaction.userId !== userId) {
        throw new NotFoundException('Transaction not found');
      }

      transactionId = transaction.id;
    }

    const ticket = await this.prisma.dispute.create({
      data: {
        userId,
        transactionId,
        type: dto.category,
        description: dto.description,
      },
      include: this.ticketInclude,
    });

    this.logger.info(
      { userId, ticketId: ticket.id, category: dto.category },
      'Support ticket created',
    );

    return ticket;
  }

  async getUserTickets(
    userId: string,
    page: number,
    limit: number,
    status?: SupportTicketStatus,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.DisputeWhereInput = {
      userId,
      ...(status ? { status } : {}),
    };

    const [tickets, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: this.ticketInclude,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return {
      tickets,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAdminTickets(
    page: number,
    limit: number,
    status?: SupportTicketStatus,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.DisputeWhereInput = status ? { status } : {};

    const [tickets, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: this.adminTicketInclude,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return {
      tickets,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async resolveTicket(
    ticketId: string,
    dto: ResolveSupportTicketDto,
    adminId: string,
  ) {
    this.assertReason(dto.reason);

    const existing = await this.prisma.dispute.findUnique({
      where: { id: ticketId },
    });

    if (!existing) {
      throw new NotFoundException('Support ticket not found');
    }

    if (['RESOLVED', 'CLOSED'].includes(existing.status)) {
      throw new BadRequestException('Support ticket is already terminal');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.dispute.update({
        where: { id: ticketId },
        data: {
          status: dto.status,
          resolution: dto.resolution || null,
          resolvedBy: adminId,
          resolvedAt: new Date(),
        },
        include: this.adminTicketInclude,
      });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'SUPPORT_TICKET_RESOLVE',
          targetType: 'Dispute',
          targetId: ticketId,
          reference: ticketId,
          reason: dto.reason,
          before: this.toJson({
            status: existing.status,
            resolution: existing.resolution,
            resolvedBy: existing.resolvedBy,
          }),
          after: this.toJson({
            status: ticket.status,
            resolution: ticket.resolution,
            resolvedBy: ticket.resolvedBy,
          }),
          metadata: this.toJson({
            category: existing.type,
            transactionId: existing.transactionId,
          }),
        },
      });

      return ticket;
    });

    this.logger.info(
      { adminId, ticketId, status: updated.status },
      'Support ticket resolved by admin',
    );

    return updated;
  }

  private assertReason(reason: string) {
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException(
        'A reason of at least 10 characters is required',
      );
    }
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    const parsed: unknown = JSON.parse(JSON.stringify(value));
    return parsed as Prisma.InputJsonValue;
  }

  private readonly ticketInclude = {
    transaction: {
      select: {
        id: true,
        reference: true,
        type: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
      },
    },
  } satisfies Prisma.DisputeInclude;

  private readonly adminTicketInclude = {
    user: {
      select: {
        id: true,
        email: true,
        phone: true,
        kycStatus: true,
        isSuspended: true,
      },
    },
    transaction: {
      select: {
        id: true,
        reference: true,
        type: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
      },
    },
  } satisfies Prisma.DisputeInclude;
}
