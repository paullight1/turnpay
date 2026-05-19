import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PinoLogger } from 'nestjs-pino';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import {
  maskAccountNumber,
  redactProviderPayload,
} from '../common/utils/masking';
import { ProvisionVirtualAccountDto } from './dto/banking.dto';
import { PaystackVirtualAccountProvider } from './providers/paystack-virtual-account.provider';
import {
  BankingProviderName,
  NormalizedDepositEvent,
  NormalizedProviderName,
} from './providers/banking-provider.types';

type PrismaProvider = 'PAYSTACK' | 'FLUTTERWAVE';

@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly paystackVirtualAccounts: PaystackVirtualAccountProvider,
    private readonly logger: PinoLogger,
  ) {}

  async getVirtualAccounts(userId: string) {
    return this.prisma.virtualAccount.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        accountNumber: true,
        accountNumberMasked: true,
        accountName: true,
        bankName: true,
        bankCode: true,
        currency: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async provisionVirtualAccount(
    userId: string,
    dto: ProvisionVirtualAccountDto,
  ) {
    const provider = dto.provider || 'paystack';
    const normalizedProvider = this.normalizeProvider(provider);

    if (provider !== 'paystack') {
      throw new BadRequestException('Provider is not supported yet');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        kycStatus: true,
        isSuspended: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('User is suspended');
    }

    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException(
        'Verified KYC is required to provision a virtual account',
      );
    }

    const providerAccount =
      await this.paystackVirtualAccounts.provisionVirtualAccount({
        userId,
        email: user.email,
        phone: user.phone,
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName,
        country: dto.country || 'NG',
        currency: dto.currency,
        bvn: dto.bvn,
        identityAccountNumber: dto.identityAccountNumber,
        identityBankCode: dto.identityBankCode,
      });

    if (!providerAccount.accountNumber || !providerAccount.accountName) {
      throw new BadRequestException(
        'Provider did not return usable account details',
      );
    }

    return this.prisma.virtualAccount.upsert({
      where: {
        userId_provider_currency: {
          userId,
          provider: normalizedProvider,
          currency: dto.currency,
        },
      },
      update: {
        providerAccountId: providerAccount.providerAccountId,
        providerCustomerId: providerAccount.providerCustomerId,
        accountNumber: providerAccount.accountNumber,
        accountNumberMasked: maskAccountNumber(providerAccount.accountNumber),
        accountName: providerAccount.accountName,
        bankName: providerAccount.bankName,
        bankCode: providerAccount.bankCode,
        status: providerAccount.status,
        metadata: this.toJsonInput(
          redactProviderPayload(providerAccount.raw || {}),
        ),
      },
      create: {
        userId,
        provider: normalizedProvider,
        providerAccountId: providerAccount.providerAccountId,
        providerCustomerId: providerAccount.providerCustomerId,
        accountNumber: providerAccount.accountNumber,
        accountNumberMasked: maskAccountNumber(providerAccount.accountNumber),
        accountName: providerAccount.accountName,
        bankName: providerAccount.bankName,
        bankCode: providerAccount.bankCode,
        currency: dto.currency,
        status: providerAccount.status,
        metadata: this.toJsonInput(
          redactProviderPayload(providerAccount.raw || {}),
        ),
      },
      select: {
        id: true,
        provider: true,
        accountNumber: true,
        accountNumberMasked: true,
        accountName: true,
        bankName: true,
        bankCode: true,
        currency: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async processVirtualAccountDeposit(event: NormalizedDepositEvent) {
    const provider = this.normalizeProvider(event.provider);
    this.assertPositiveAmount(event.amount);

    const existing = await this.prisma.providerEvent.findUnique({
      where: {
        provider_providerReference_eventType: {
          provider,
          providerReference: event.providerReference,
          eventType: event.eventType,
        },
      },
    });

    if (existing?.status === 'PROCESSED') {
      this.logger.info(
        {
          provider,
          providerReference: event.providerReference,
          eventType: event.eventType,
        },
        'Provider event already processed',
      );
      return { received: true, processed: false };
    }

    const providerEvent =
      existing ||
      (await this.prisma.providerEvent.create({
        data: {
          provider,
          eventType: event.eventType,
          providerReference: event.providerReference,
          status: 'PROCESSING',
          payload: this.toJsonInput(redactProviderPayload(event.rawPayload)),
          payloadHash: this.hashPayload(event.rawPayload),
        },
      }));

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const virtualAccount = await tx.virtualAccount.findUnique({
          where: {
            provider_accountNumber: {
              provider,
              accountNumber: event.accountNumber,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                isSuspended: true,
                kycStatus: true,
              },
            },
          },
        });

        if (!virtualAccount) {
          throw new NotFoundException('Virtual account not found');
        }

        if (virtualAccount.status !== 'ACTIVE') {
          throw new BadRequestException('Virtual account is not active');
        }

        if (virtualAccount.user.isSuspended) {
          throw new ForbiddenException('User is suspended');
        }

        if (virtualAccount.user.kycStatus !== 'VERIFIED') {
          throw new ForbiddenException('Verified KYC is required for deposits');
        }

        if (virtualAccount.currency !== event.currency) {
          throw new BadRequestException(
            'Deposit currency does not match virtual account',
          );
        }

        const transaction = await tx.transaction.create({
          data: {
            userId: virtualAccount.userId,
            walletId: undefined,
            type: 'FUND',
            amount: event.amount,
            currency: event.currency,
            status: 'SUCCESS',
            reference: event.providerReference,
            metadata: {
              provider,
              channel: 'virtual_account',
              virtualAccountId: virtualAccount.id,
              accountNumberMasked: virtualAccount.accountNumberMasked,
              providerEventId: providerEvent.id,
            },
          },
        });

        await this.ledger.creditWallet(
          {
            userId: virtualAccount.userId,
            currency: event.currency,
            amount: event.amount,
            transactionId: transaction.id,
            reference: event.providerReference,
            source: `${provider}_DVA`,
            metadata: {
              providerEventId: providerEvent.id,
              virtualAccountId: virtualAccount.id,
            },
          },
          tx,
        );

        await tx.providerEvent.update({
          where: { id: providerEvent.id },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });

        return { received: true, processed: true };
      });

      return result;
    } catch (error) {
      await this.prisma.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: 'FAILED',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown processing error',
          processedAt: new Date(),
        },
      });

      throw error;
    }
  }

  private normalizeProvider(
    provider: BankingProviderName,
  ): NormalizedProviderName;
  private normalizeProvider(provider: string): PrismaProvider;
  private normalizeProvider(provider: string): PrismaProvider {
    const normalized = provider.toUpperCase();
    if (normalized !== 'PAYSTACK' && normalized !== 'FLUTTERWAVE') {
      throw new BadRequestException('Unsupported provider');
    }
    return normalized;
  }

  private assertPositiveAmount(amount: Decimal) {
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be positive');
    }
  }

  private hashPayload(payload: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private toJsonInput(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
