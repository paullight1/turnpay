import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionType } from '@prisma/client';
import { WalletsService } from '../wallets/wallets.service';
import { VtuApiProvider } from './providers/vtu-api.provider';
import { PurchaseVtuDto } from './dto/vtu.dto';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class VtuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly vtuApi: VtuApiProvider,
    private readonly logger: PinoLogger,
  ) {}

  async getProviders(type?: string) {
    return this.vtuApi.getProviders(type);
  }

  async getPackages(provider: string) {
    return this.vtuApi.getPackages(provider);
  }

  async validateSmartCard(provider: string, smartCardNumber: string) {
    return this.vtuApi.validateSmartCard(provider, smartCardNumber);
  }

  async validateMeter(provider: string, meterNumber: string) {
    return this.vtuApi.validateMeter(provider, meterNumber);
  }

  async purchase(userId: string, dto: PurchaseVtuDto) {
    const wallet = await this.walletsService.getWallet(userId, 'NGN');
    if (!wallet) {
      throw new NotFoundException('NGN wallet not found');
    }

    if (wallet.balance.lt(dto.amount)) {
      throw new BadRequestException(
        `Insufficient NGN balance. Required: ${dto.amount}`,
      );
    }

    const reference = `VTU-${Date.now()}-${uuidv4().slice(0, 8)}`;

    let purchaseResult: { reference: string; status: string; message: string };

    try {
      await this.prisma.$transaction(async (tx) => {
        const deducted = await tx.wallet.updateMany({
          where: {
            id: wallet.id,
            balance: { gte: dto.amount },
          },
          data: { balance: { decrement: dto.amount } },
        });

        if (deducted.count !== 1) {
          throw new BadRequestException(
            `Insufficient NGN balance. Required: ${dto.amount}`,
          );
        }

        await tx.transaction.create({
          data: {
            userId,
            type: this.mapVtuType(dto.type),
            amount: dto.amount,
            currency: 'NGN',
            status: 'PENDING',
            reference,
            walletId: wallet.id,
            metadata: {
              vtuType: dto.type,
              provider: dto.provider,
              recipientNumber: dto.recipientNumber,
              packageId: dto.packageId,
              smartCardNumber: dto.smartCardNumber,
              meterNumber: dto.meterNumber,
            },
          },
        });
      });

      purchaseResult = await this.vtuApi.purchase({
        type: dto.type,
        provider: dto.provider,
        recipientNumber: dto.recipientNumber,
        amount: dto.amount,
        packageId: dto.packageId,
        smartCardNumber: dto.smartCardNumber,
        meterNumber: dto.meterNumber,
      });

      if (purchaseResult.status === 'success') {
        await this.prisma.transaction.update({
          where: { reference },
          data: { status: 'SUCCESS' },
        });

        this.logger.info(
          {
            userId,
            reference,
            type: dto.type,
            provider: dto.provider,
            amount: dto.amount,
          },
          'VTU purchase successful',
        );
      } else {
        await this.reverseVtuPurchase(userId, reference, dto.amount);
        throw new BadRequestException(
          `VTU purchase failed: ${purchaseResult.message}`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      await this.reverseVtuPurchase(userId, reference, dto.amount);

      this.logger.error(
        {
          userId,
          reference,
          error: error instanceof Error ? error.message : 'Unknown VTU error',
        },
        'VTU purchase failed, balance reversed',
      );

      throw new BadRequestException(
        'VTU purchase failed. Balance has been reversed.',
      );
    }

    return {
      success: true,
      reference,
      message: purchaseResult.message,
      amount: dto.amount,
    };
  }

  private async reverseVtuPurchase(
    userId: string,
    reference: string,
    amount: number,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findFirst({
        where: { userId, currency: 'NGN' },
      });

      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: amount } },
        });
      }

      await tx.transaction.update({
        where: { reference },
        data: { status: 'FAILED' },
      });
    });

    this.logger.info(
      { userId, reference, amount },
      'VTU purchase reversed, balance restored',
    );
  }

  private mapVtuType(type: string): TransactionType {
    const typeMap: Record<string, TransactionType> = {
      airtime: 'AIRTIME',
      data: 'DATA',
      cable: 'CABLE',
      electricity: 'ELECTRICITY',
    };

    return typeMap[type] || 'AIRTIME';
  }
}
