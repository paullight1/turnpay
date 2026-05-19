import { Injectable, Logger } from '@nestjs/common';
import { WalletCurrency } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);
  private readonly currencies: WalletCurrency[] = ['NGN', 'GHS'];

  constructor(private readonly prisma: PrismaService) {}

  async provisionWallets(userId: string) {
    const wallets = await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        this.currencies.map((currency) =>
          tx.wallet.upsert({
            where: {
              userId_currency: {
                userId,
                currency,
              },
            },
            update: {},
            create: {
              userId,
              currency,
              balance: 0,
            },
          }),
        ),
      );

      return tx.wallet.findMany({
        where: { userId },
        select: this.walletSelect,
        orderBy: { currency: 'desc' },
      });
    });

    this.logger.log(`Ensured ${wallets.length} wallets for user ${userId}`);

    return wallets;
  }

  async getWallets(userId: string) {
    const wallets = await this.findWallets(userId);

    if (wallets.length >= this.currencies.length) {
      return wallets;
    }

    return this.provisionWallets(userId);
  }

  private findWallets(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      select: this.walletSelect,
      orderBy: { currency: 'desc' },
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

  private readonly walletSelect = {
    id: true,
    currency: true,
    balance: true,
    updatedAt: true,
  } as const;
}
