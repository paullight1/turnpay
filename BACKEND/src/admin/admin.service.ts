import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUpdateUserDto } from './dto/admin.dto';
import { PinoLogger } from 'nestjs-pino';
import { TransactionStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async getUsers(
    page: number,
    limit: number,
    role?: string,
    kycStatus?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};

    if (role) where.role = role;
    if (kycStatus) where.kycStatus = kycStatus;

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
          kycStatus: true,
          isSuspended: true,
          createdAt: true,
          wallets: {
            select: {
              currency: true,
              balance: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        kycStatus: true,
        isSuspended: true,
        createdAt: true,
        updatedAt: true,
        wallets: true,
        transactions: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            amount: true,
            currency: true,
            status: true,
            reference: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateUser(userId: string, dto: AdminUpdateUserDto, adminId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        kycStatus: true,
        isSuspended: true,
        updatedAt: true,
      },
    });

    this.logger.info({ adminId, userId, changes: dto }, 'Admin updated user');

    return updated;
  }

  async suspendUser(userId: string, adminId: string) {
    return this.updateUser(userId, { isSuspended: true }, adminId);
  }

  async unsuspendUser(userId: string, adminId: string) {
    return this.updateUser(userId, { isSuspended: false }, adminId);
  }

  async getStats() {
    const [
      totalUsers,
      totalTransactions,
      volumeResult,
      feeResult,
      activeUsers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.transaction.count(),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { status: 'SUCCESS' },
      }),
      this.prisma.transaction.aggregate({
        _sum: { fee: true },
        where: { status: 'SUCCESS' },
      }),
      this.prisma.user.count({
        where: {
          transactions: {
            some: {
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              },
            },
          },
        },
      }),
    ]);

    return {
      totalUsers,
      totalTransactions,
      totalVolume: Number(volumeResult._sum.amount || 0),
      totalFees: Number(feeResult._sum.fee || 0),
      activeUsers,
    };
  }

  async getRecentTransactions(limit = 20) {
    return this.prisma.transaction.findMany({
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
      },
    });
  }

  async updateTransactionStatus(
    reference: string,
    status: TransactionStatus,
    adminId: string,
  ) {
    const allowedStatuses: TransactionStatus[] = [
      'PENDING',
      'SUCCESS',
      'FAILED',
      'REVERSED',
    ];

    if (!allowedStatuses.includes(status)) {
      throw new BadRequestException('Invalid transaction status');
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { reference },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const updated = await this.prisma.transaction.update({
      where: { reference },
      data: { status },
    });

    this.logger.info(
      { adminId, reference, oldStatus: transaction.status, newStatus: status },
      'Admin updated transaction status',
    );

    return updated;
  }
}
