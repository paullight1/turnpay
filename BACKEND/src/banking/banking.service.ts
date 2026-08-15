import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PinoLogger } from 'nestjs-pino';
import { createHash } from 'crypto';
import { KYCTier, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import {
  maskAccountNumber,
  redactProviderPayload,
} from '../common/utils/masking';
import { decryptSensitiveValue } from '../common/utils/encryption';
import { ProvisionVirtualAccountDto } from './dto/banking.dto';
import { MonnifyVirtualAccountProvider } from './providers/monnify-virtual-account.provider';
import {
  BankingProviderName,
  NormalizedDepositEvent,
  NormalizedProviderName,
  ProviderVirtualAccount,
  ProvisionVirtualAccountInput,
} from './providers/banking-provider.types';
import { formatKycTier, isKycTierAtLeast } from '../common/utils/kyc-tier';

type PrismaProvider = 'PAYSTACK' | 'FLUTTERWAVE' | 'MONNIFY';

@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly monnifyVirtualAccounts: MonnifyVirtualAccountProvider,
    private readonly configService: ConfigService,
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
    this.assertVirtualAccountsEnabled();

    const provider = dto.provider || this.defaultVirtualAccountProvider;
    const normalizedProvider = this.normalizeProvider(provider);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('User is suspended');
    }

    const existingAccount = await this.prisma.virtualAccount.findUnique({
      where: {
        userId_provider_currency: {
          userId,
          provider: normalizedProvider,
          currency: dto.currency,
        },
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

    // bankCode is optional in the provider response — requiring it here would
    // re-provision against the provider on every call for accounts that were
    // issued without one.
    if (
      existingAccount?.accountNumber &&
      existingAccount.accountName &&
      existingAccount.bankName
    ) {
      this.logger.info(
        { userId, provider: normalizedProvider, currency: dto.currency },
        'Reusing existing virtual account',
      );

      return existingAccount;
    }

    const canUseSandboxKycBypass = this.canUseSandboxKycBypass();

    if (user.kycStatus !== 'VERIFIED' && !canUseSandboxKycBypass) {
      throw new ForbiddenException(
        'Verified KYC is required to provision a virtual account',
      );
    }

    if (!isKycTierAtLeast(user.kycTier, 'TIER_2') && !canUseSandboxKycBypass) {
      throw new ForbiddenException(
        `KYC ${formatKycTier('TIER_2')} is required to provision a virtual account`,
      );
    }

    const verifiedIdentifiers = await this.resolveVerifiedKycIdentifiers(
      userId,
      {
        bvn: dto.bvn,
        nin: dto.nin,
      },
    );

    const providerInput: ProvisionVirtualAccountInput = {
      userId,
      email: user.email,
      phone: user.phone,
      accountHolderName: this.resolveAccountHolderName(user.fullName, dto),
      firstName: dto.firstName,
      lastName: dto.lastName,
      middleName: dto.middleName,
      country: dto.country || 'NG',
      currency: dto.currency,
      bvn:
        dto.bvn ||
        verifiedIdentifiers.bvn ||
        this.sandboxTestIdentifier('MONNIFY_TEST_BVN'),
      nin:
        dto.nin ||
        verifiedIdentifiers.nin ||
        this.sandboxTestIdentifier('MONNIFY_TEST_NIN'),
      identityAccountNumber: dto.identityAccountNumber,
      identityBankCode: dto.identityBankCode,
    };

    if (
      canUseSandboxKycBypass &&
      !dto.bvn &&
      !dto.nin &&
      !verifiedIdentifiers.bvn &&
      !verifiedIdentifiers.nin
    ) {
      this.logger.warn(
        { userId, provider },
        'Using Monnify sandbox test KYC identifier for virtual account provisioning',
      );
    }

    const providerAccount = await this.provisionWithProvider(
      provider,
      providerInput,
    );

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
      (await this.createDepositProviderEvent({
        provider,
        eventType: event.eventType,
        providerReference: event.providerReference,
        rawPayload: event.rawPayload,
      }));

    if (!providerEvent) {
      return { received: true, processed: false, duplicate: true };
    }

    if (providerEvent.status === 'PROCESSED') {
      return { received: true, processed: false };
    }

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
                kycTier: true,
              },
            },
          },
        });

        if (!virtualAccount) {
          throw new NotFoundException('Virtual account not found');
        }

        if (
          virtualAccount.status === 'FAILED' ||
          virtualAccount.status === 'DISABLED'
        ) {
          throw new BadRequestException('Virtual account is not active');
        }

        if (virtualAccount.status !== 'ACTIVE') {
          await tx.virtualAccount.update({
            where: { id: virtualAccount.id },
            data: { status: 'ACTIVE' },
          });

          this.logger.info(
            {
              virtualAccountId: virtualAccount.id,
              provider,
              accountNumberMasked: maskAccountNumber(event.accountNumber),
            },
            'Promoted pending virtual account to active after deposit',
          );
        }

        const accountUser = virtualAccount.user as {
          isSuspended: boolean;
          kycStatus: string;
          kycTier?: KYCTier | null;
        };

        if (accountUser.isSuspended) {
          throw new ForbiddenException('User is suspended');
        }

        if (accountUser.kycStatus !== 'VERIFIED') {
          throw new ForbiddenException('Verified KYC is required for deposits');
        }

        if (!isKycTierAtLeast(accountUser.kycTier, 'TIER_2')) {
          throw new ForbiddenException(
            `KYC ${formatKycTier('TIER_2')} is required for deposits`,
          );
        }

        if (virtualAccount.currency !== event.currency) {
          throw new BadRequestException(
            'Deposit currency does not match virtual account',
          );
        }

        const transaction = await tx.transaction.create({
          data: {
            userId: virtualAccount.userId,
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
              // Gross amount is credited; the net the provider settles is kept
              // for fee reconciliation.
              settlementAmount: event.settlementAmount?.toString(),
            },
          },
        });

        const creditResult = await this.ledger.creditWallet(
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

        await tx.transaction.update({
          where: { id: transaction.id },
          data: { walletId: creditResult.walletId },
        });

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
    if (
      normalized !== 'PAYSTACK' &&
      normalized !== 'FLUTTERWAVE' &&
      normalized !== 'MONNIFY'
    ) {
      throw new BadRequestException('Unsupported provider');
    }
    return normalized;
  }

  private async provisionWithProvider(
    provider: BankingProviderName,
    input: ProvisionVirtualAccountInput,
  ): Promise<ProviderVirtualAccount> {
    if (provider !== 'monnify') {
      throw new BadRequestException(
        'Only Monnify virtual accounts are enabled',
      );
    }

    return this.monnifyVirtualAccounts.provisionVirtualAccount(input);
  }

  private resolveAccountHolderName(
    fullName: string | null | undefined,
    dto: ProvisionVirtualAccountDto,
  ) {
    // The profile's legal name is the source of truth for what the partner
    // bank displays; client-supplied names are only a fallback for accounts
    // created before the profile captured a legal name.
    const profileName = fullName?.replace(/\s+/g, ' ').trim();
    if (profileName) {
      return profileName;
    }

    const dtoName = [dto.firstName, dto.middleName, dto.lastName]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (dtoName) {
      return dtoName;
    }

    throw new BadRequestException(
      'Add your legal name to your profile before requesting a virtual account',
    );
  }

  private async resolveVerifiedKycIdentifiers(
    userId: string,
    explicitIdentifiers: { bvn?: string; nin?: string },
  ) {
    if (explicitIdentifiers.bvn && explicitIdentifiers.nin) {
      return {};
    }

    const documents = await this.prisma.kycDocument.findMany({
      where: {
        userId,
        status: 'VERIFIED',
        type: { in: ['BVN', 'NIN'] },
      },
      select: {
        type: true,
        idNumber: true,
      },
      orderBy: [{ reviewedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    const identifiers: { bvn?: string; nin?: string } = {};

    for (const document of documents) {
      if (
        document.type === 'BVN' &&
        !explicitIdentifiers.bvn &&
        !identifiers.bvn &&
        document.idNumber
      ) {
        identifiers.bvn = this.decryptStoredKycIdentifier(document.idNumber);
      }

      if (
        document.type === 'NIN' &&
        !explicitIdentifiers.nin &&
        !identifiers.nin &&
        document.idNumber
      ) {
        identifiers.nin = this.decryptStoredKycIdentifier(document.idNumber);
      }
    }

    return identifiers;
  }

  private decryptStoredKycIdentifier(idNumber: string) {
    if (!idNumber.startsWith('enc:v1:')) {
      return idNumber;
    }

    return decryptSensitiveValue(
      idNumber.slice('enc:v1:'.length),
      this.configService.get<string>('PII_ENCRYPTION_KEY'),
    );
  }

  private canUseSandboxKycBypass() {
    const isProduction =
      this.configService.get<string>('NODE_ENV', 'development') ===
      'production';
    const sandboxMode = this.configService.get<boolean>(
      'BANKING_SANDBOX_MODE',
      false,
    );
    const bypassEnabled = this.configService.get<boolean>(
      'MONNIFY_SANDBOX_TEST_KYC_BYPASS',
      false,
    );

    return !isProduction && sandboxMode && bypassEnabled;
  }

  private sandboxTestIdentifier(key: 'MONNIFY_TEST_BVN' | 'MONNIFY_TEST_NIN') {
    if (!this.canUseSandboxKycBypass()) {
      return undefined;
    }

    const value = this.configService.get<string>(key);
    return value?.trim() || undefined;
  }

  private get defaultVirtualAccountProvider(): BankingProviderName {
    const configured = this.configService.get<string>(
      'BANKING_PROVIDER_PRIMARY',
      'monnify',
    );

    if (configured === 'monnify') {
      return configured;
    }

    throw new BadRequestException(
      'Only Monnify can be configured as the virtual account provider',
    );
  }

  private assertVirtualAccountsEnabled() {
    const bankingEnabled = this.configService.get<boolean>(
      'BANKING_ENABLED',
      false,
    );
    const virtualAccountsEnabled = this.configService.get<boolean>(
      'VIRTUAL_ACCOUNTS_ENABLED',
      false,
    );

    if (!bankingEnabled || !virtualAccountsEnabled) {
      throw new ForbiddenException('Virtual accounts are not enabled');
    }
  }

  private assertPositiveAmount(amount: Decimal) {
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be positive');
    }
  }

  private hashPayload(payload: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async createDepositProviderEvent(input: {
    provider: PrismaProvider;
    eventType: string;
    providerReference: string;
    rawPayload: Record<string, unknown>;
  }) {
    try {
      return await this.prisma.providerEvent.create({
        data: {
          provider: input.provider,
          eventType: input.eventType,
          providerReference: input.providerReference,
          status: 'PROCESSING',
          payload: this.toJsonInput(redactProviderPayload(input.rawPayload)),
          payloadHash: this.hashPayload(input.rawPayload),
        },
      });
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      return null;
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private toJsonInput(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
