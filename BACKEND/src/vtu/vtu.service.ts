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
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../wallets/ledger.service';
import { maskAccountNumber, maskPhone } from '../common/utils/masking';

@Injectable()
export class VtuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly vtuApi: VtuApiProvider,
    private readonly logger: PinoLogger,
    private readonly ledger: LedgerService,
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

    const amount = new Decimal(dto.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be positive');
    }

    if (new Decimal(wallet.balance).lessThan(amount)) {
      throw new BadRequestException(
        `Insufficient NGN balance. Required: ${dto.amount}`,
      );
    }

    const reference = `VTU-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const metadata = this.buildSafeMetadata(dto);

    const transactionRecord = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: this.mapVtuType(dto.type),
          amount,
          currency: 'NGN',
          status: 'PENDING',
          reference,
          walletId: wallet.id,
          metadata,
        },
      });

      await this.ledger.debitWallet(
        {
          userId,
          currency: 'NGN',
          amount,
          transactionId: transaction.id,
          reference,
          source: 'VTU_PURCHASE',
          metadata,
        },
        tx,
      );

      return { id: transaction.id, reference: transaction.reference };
    });

    let purchaseResult: { reference: string; status: string; message: string };

    try {
      purchaseResult = await this.vtuApi.purchase({
        type: dto.type,
        provider: dto.provider,
        recipientNumber: dto.recipientNumber,
        amount: dto.amount,
        reference,
        packageId: dto.packageId,
        smartCardNumber: dto.smartCardNumber,
        meterNumber: dto.meterNumber,
      });
    } catch (error) {
      await this.reverseVtuPurchase(
        userId,
        transactionRecord,
        amount,
        'Provider request failed',
        metadata,
      );

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

    if (purchaseResult.status !== 'success') {
      await this.reverseVtuPurchase(
        userId,
        transactionRecord,
        amount,
        purchaseResult.message,
        {
          ...metadata,
          providerReference: purchaseResult.reference,
          providerStatus: purchaseResult.status,
        },
      );
      throw new BadRequestException(
        `VTU purchase failed: ${purchaseResult.message}`,
      );
    }

    await this.prisma.transaction.update({
      where: { reference: transactionRecord.reference },
      data: {
        status: 'SUCCESS',
        metadata: {
          ...metadata,
          providerReference: purchaseResult.reference,
          providerStatus: purchaseResult.status,
        },
      },
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

    return {
      success: true,
      reference: transactionRecord.reference,
      message: purchaseResult.message,
      amount: dto.amount,
    };
  }

  private async reverseVtuPurchase(
    userId: string,
    transaction: { id: string; reference: string },
    amount: Decimal,
    reason: string,
    metadata: Record<string, unknown>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const existingReversal = await tx.ledgerEntry.findFirst({
        where: {
          transactionId: transaction.id,
          source: 'VTU_REVERSAL',
        },
      });

      if (!existingReversal) {
        await this.ledger.creditWallet(
          {
            userId,
            currency: 'NGN',
            amount,
            transactionId: transaction.id,
            reference: `${transaction.reference}-REVERSAL`,
            source: 'VTU_REVERSAL',
            metadata: {
              ...metadata,
              reversalReason: reason,
            },
          },
          tx,
        );
      }

      await tx.transaction.update({
        where: { reference: transaction.reference },
        data: {
          status: 'FAILED',
          metadata: {
            ...metadata,
            reversalReason: reason,
          },
        },
      });
    });

    this.logger.info(
      { userId, reference: transaction.reference, amount: amount.toString() },
      'VTU purchase reversed, balance restored',
    );
  }

  private buildSafeMetadata(dto: PurchaseVtuDto) {
    return {
      vtuType: dto.type,
      provider: dto.provider,
      recipientNumberMasked: maskPhone(dto.recipientNumber),
      packageId: dto.packageId,
      smartCardNumberMasked: dto.smartCardNumber
        ? maskAccountNumber(dto.smartCardNumber)
        : undefined,
      meterNumberMasked: dto.meterNumber
        ? maskAccountNumber(dto.meterNumber)
        : undefined,
    };
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
