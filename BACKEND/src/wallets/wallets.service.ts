import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async provisionWallets(userId: string) {
    const currencies = ['NGN', 'GHS'] as const;

    try {
      const wallets = await this.prisma.$transaction(
        currencies.map((currency) =>
          this.prisma.wallet.create({
            data: {
              userId,
              currency,
              balance: 0,
            },
          }),
        ),
      );

      this.logger.log(
        `Provisioned ${wallets.length} wallets for user ${userId}`,
      );

      return wallets;
    } catch (error: any) {
      if (error.code === 'P2002') {
        this.logger.warn(`Wallets already exist for user ${userId}`);
        return this.getWallets(userId);
      }
      throw error;
    }
  }

  async getWallets(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      select: {
        id: true,
        currency: true,
        balance: true,
        updatedAt: true,
      },
    });
  }

  async getWallet(userId: string, currency: string) {
    return this.prisma.wallet.findUnique({
      where: {
        userId_currency: {
          userId,
          currency: currency as 'NGN' | 'GHS',
        },
      },
    });
  }

  async getBalance(userId: string, currency: string) {
    const wallet = await this.getWallet(userId, currency);
    return wallet?.balance ?? 0;
  }
}
