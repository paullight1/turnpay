import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserTransactions(
    userId: string,
    page: number,
    limit: number,
    status?: string,
    type?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { userId };

    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }

    const [transactions, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          amount: true,
          currency: true,
          status: true,
          reference: true,
          fee: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      transactions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getTransactionByReference(reference: string, userId: string) {
    return this.prisma.transaction.findFirst({
      where: { reference, userId },
      include: {
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            direction: true,
            amount: true,
            currency: true,
            balanceBefore: true,
            balanceAfter: true,
            source: true,
            createdAt: true,
          },
        },
        transferAttempts: {
          orderBy: { attemptNo: 'asc' },
          select: {
            id: true,
            provider: true,
            providerReference: true,
            providerStatus: true,
            status: true,
            attemptNo: true,
            metadata: true,
            createdAt: true,
          },
        },
        exchangeReceipt: {
          select: {
            id: true,
            status: true,
            sourceCurrency: true,
            targetCurrency: true,
            amount: true,
            expectedCreditAmount: true,
            rate: true,
            senderName: true,
            senderBankName: true,
            bankReference: true,
            reviewReason: true,
            creditedAt: true,
          },
        },
        exchangePayout: {
          select: {
            id: true,
            status: true,
            sourceCurrency: true,
            destinationCurrency: true,
            sourceAmount: true,
            destinationAmount: true,
            rate: true,
            fee: true,
            destinationBankName: true,
            destinationAccountNumber: true,
            destinationAccountName: true,
          },
        },
        vtuOrders: {
          select: {
            id: true,
            provider: true,
            serviceType: true,
            status: true,
            amount: true,
            targetMasked: true,
            providerRequestId: true,
          },
        },
        disputes: {
          select: {
            id: true,
            type: true,
            status: true,
            description: true,
            resolution: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getTransactionDetailForAdmin(reference: string) {
    return this.prisma.transaction.findFirst({
      where: { reference },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            fullName: true,
            kycStatus: true,
            kycTier: true,
          },
        },
        wallet: {
          select: {
            id: true,
            currency: true,
          },
        },
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            direction: true,
            amount: true,
            currency: true,
            balanceBefore: true,
            balanceAfter: true,
            source: true,
            createdAt: true,
          },
        },
        transferAttempts: {
          orderBy: { attemptNo: 'asc' },
          select: {
            id: true,
            provider: true,
            providerReference: true,
            providerStatus: true,
            status: true,
            attemptNo: true,
            metadata: true,
            createdAt: true,
          },
        },
        exchangeReceipt: {
          select: {
            id: true,
            status: true,
            sourceCurrency: true,
            targetCurrency: true,
            amount: true,
            expectedCreditAmount: true,
            rate: true,
            senderName: true,
            senderBankName: true,
            bankReference: true,
            reviewReason: true,
            creditedAt: true,
            reviewedAt: true,
          },
        },
        exchangePayout: {
          select: {
            id: true,
            status: true,
            sourceCurrency: true,
            destinationCurrency: true,
            sourceAmount: true,
            destinationAmount: true,
            rate: true,
            fee: true,
            destinationBankName: true,
            destinationAccountNumber: true,
            destinationAccountName: true,
            adminNote: true,
          },
        },
        vtuOrders: {
          select: {
            id: true,
            provider: true,
            serviceType: true,
            status: true,
            amount: true,
            targetMasked: true,
            providerRequestId: true,
            providerTransactionId: true,
            requeryAttempts: true,
            completedAt: true,
            failedAt: true,
          },
        },
        disputes: {
          select: {
            id: true,
            type: true,
            status: true,
            description: true,
            resolution: true,
            resolvedBy: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getTransactionAuditTrail(reference: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { reference },
      select: { id: true },
    });

    if (!transaction) return [];

    return this.prisma.auditLog.findMany({
      where: {
        OR: [
          { targetType: 'TRANSACTION', targetId: transaction.id },
          { reference },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });
  }

  async getAllTransactions(
    page: number,
    limit: number,
    status?: string,
    type?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }

    const [transactions, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
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
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      transactions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
