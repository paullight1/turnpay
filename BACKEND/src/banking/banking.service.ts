import { KoraAccountsService } from '../kora/kora-accounts.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaystackVirtualAccountProvider } from './providers/paystack-virtual-account.provider';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
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
import { allocateDepositReference } from '../common/services/deposit-allocation';

type PrismaProvider = 'MONNIFY' | 'PAYSTACK' | 'KORA';

@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly monnifyVirtualAccounts: MonnifyVirtualAccountProvider,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    @Optional() private readonly paystack?: PaystackVirtualAccountProvider,
    @Optional() private readonly koraAccounts?: KoraAccountsService,
  ) {}

  async getVirtualAccounts(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true, kycTier: true },
    });
    const canRevealAccountNumber =
      user != null &&
      user.kycStatus === 'VERIFIED' &&
      isKycTierAtLeast(user.kycTier, 'TIER_1');
    const accounts = await this.prisma.virtualAccount.findMany({
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

    if (canRevealAccountNumber) return accounts;

    return accounts.map((account) => ({
      ...account,
      accountNumber: '',
    }));
  }

  async getAccountProvisioning(userId: string) {
    const request = await this.prisma.paystackAccountRequest.findUnique({
      where: { userId },
      select: { status: true, lastError: true, updatedAt: true },
    });
    return {
      provider: 'PAYSTACK',
      status: request?.status ?? 'NOT_REQUESTED',
      message: request?.lastError ?? undefined,
      updatedAt: request?.updatedAt,
    };
  }

  async getTransferStatus(reference: string) {
    const attempt = await this.prisma.transferAttempt.findFirst({
      where: { providerReference: reference },
      select: { provider: true },
    });
    if (attempt?.provider === 'KORA')
      throw new BadRequestException(
        'Use Ghana payment status for this transfer',
      );
    if (attempt?.provider === 'PAYSTACK') {
      if (!this.paystack)
        throw new ServiceUnavailableException('Paystack is not configured');
      return this.paystack.getTransferStatus(reference);
    }
    return this.monnifyVirtualAccounts.getTransferStatus(reference);
  }

  async provisionVirtualAccount(
    userId: string,
    dto: ProvisionVirtualAccountDto,
    idempotencyKey?: string,
  ) {
    if (dto.currency === 'GHS') {
      if (dto.provider && dto.provider !== 'kora')
        throw new BadRequestException('GHS accounts use Kora');
      if (dto.consentAccepted !== true)
        throw new BadRequestException('Account setup consent is required');
      if (!this.koraAccounts)
        throw new ServiceUnavailableException('Ghana accounts are unavailable');
      return this.koraAccounts.ensureAccount(userId, idempotencyKey ?? '');
    }
    this.assertVirtualAccountsEnabled();

    const provider = dto.provider || this.defaultVirtualAccountProvider;
    const normalizedProvider = this.normalizeProvider(provider);
    if (provider !== this.defaultVirtualAccountProvider)
      throw new BadRequestException(
        'New accounts must use the configured banking provider',
      );

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

    if (
      !this.canUseSandboxKycBypass() &&
      (user.kycStatus !== 'VERIFIED' ||
        !isKycTierAtLeast(user.kycTier, 'TIER_1'))
    ) {
      throw new ForbiddenException(
        'Complete KYC before accessing a virtual account',
      );
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

    if (!isKycTierAtLeast(user.kycTier, 'TIER_1') && !canUseSandboxKycBypass) {
      throw new ForbiddenException(
        `KYC ${formatKycTier('TIER_1')} is required to provision a virtual account`,
      );
    }

    if (provider === 'paystack') {
      if (!this.paystack?.configured)
        throw new ServiceUnavailableException('Paystack is not configured');
      const binding = await this.prisma.paystackCustomer.findUnique({
        where: { userId },
      });
      if (binding?.validationStatus !== 'VERIFIED')
        throw new ForbiddenException(
          'Complete Paystack BVN and bank-account verification before requesting an account',
        );
      if (dto.consentAccepted === true)
        await this.prisma.paystackCustomer.update({
          where: { userId },
          data: { accountSetupConsentAt: new Date() },
        });
    }
    const verifiedIdentifiers: { bvn?: string; nin?: string } =
      provider === 'paystack'
        ? {}
        : await this.resolveVerifiedKycIdentifiers(userId, {
            bvn: dto.bvn,
            nin: dto.nin,
          });

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
        verifiedIdentifiers.bvn ||
        this.sandboxTestIdentifier('MONNIFY_TEST_BVN'),
      nin:
        verifiedIdentifiers.nin ||
        this.sandboxTestIdentifier('MONNIFY_TEST_NIN'),
      limitProfileCode:
        provider === 'paystack'
          ? undefined
          : this.resolveMonnifyLimitProfileCode(
              verifiedIdentifiers.bvn && verifiedIdentifiers.nin
                ? 'TIER_2'
                : 'TIER_1',
            ),
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

    let providerAccount: ProviderVirtualAccount;
    try {
      providerAccount = await this.provisionWithProvider(
        provider,
        providerInput,
      );
    } catch (error) {
      if (
        provider !== 'paystack' ||
        !(error instanceof ServiceUnavailableException)
      )
        throw error;
      return {
        status: 'PENDING' as const,
        accountNumber: '',
        provider: 'PAYSTACK' as const,
        currency: 'NGN' as const,
        message: 'Your account is being prepared. Refresh its status shortly.',
        accountNumberMasked: undefined,
        bankName: undefined,
      };
    }

    if (!providerAccount.accountNumber || !providerAccount.accountName) {
      throw new BadRequestException(
        'Provider did not return usable account details',
      );
    }

    const account = await this.prisma.virtualAccount.upsert({
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
    if (provider === 'paystack')
      await this.prisma.paystackAccountRequest.update({
        where: { userId },
        data: {
          status: 'ACTIVE',
          claimedAt: null,
          nextAttemptAt: null,
          lastError: null,
        },
      });
    return account;
  }

  async processPaystackAccountAssignment(
    eventType: string,
    data: Record<string, unknown>,
  ) {
    const customer = data.customer as Record<string, unknown> | undefined;
    const code =
      typeof data.customer_code === 'string'
        ? data.customer_code
        : customer?.customer_code;
    if (typeof code !== 'string')
      throw new BadRequestException(
        'Customer identity missing from account event',
      );
    const binding = await this.prisma.paystackCustomer.findUnique({
      where: { customerCode: code },
    });
    if (!binding) throw new NotFoundException('Paystack customer not found');
    if (eventType.endsWith('.failed')) {
      await this.prisma.paystackAccountRequest.updateMany({
        where: { userId: binding.userId, status: 'PENDING' },
        data: {
          claimedAt: null,
          lastError: 'Paystack could not prepare the account',
          nextAttemptAt: new Date(Date.now() + 300000),
        },
      });
      return { pending: true };
    }
    return this.provisionVirtualAccount(binding.userId, {
      currency: 'NGN',
      provider: 'paystack',
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryPaystackAccountPreparation() {
    if (this.defaultVirtualAccountProvider !== 'paystack') return;
    const due = await this.prisma.paystackAccountRequest.findMany({
      where: {
        status: 'PENDING',
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });
    for (const request of due) {
      try {
        await this.provisionVirtualAccount(request.userId, {
          currency: 'NGN',
          provider: 'paystack',
        });
      } catch {
        this.logger.warn(
          { requestId: request.id },
          'Paystack account retry needs confirmation',
        );
      }
    }
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

        if (!isKycTierAtLeast(accountUser.kycTier, 'TIER_1')) {
          throw new ForbiddenException(
            `KYC ${formatKycTier('TIER_1')} is required for deposits`,
          );
        }

        if (virtualAccount.currency !== event.currency) {
          throw new BadRequestException(
            'Deposit currency does not match virtual account',
          );
        }

        await allocateDepositReference(tx, {
          reference: event.providerReference,
          settlementId: `funding:${providerEvent.id}`,
          amount: event.amount,
          kind: 'FUNDING',
        });
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

        await tx.auditLog.create({
          data: {
            action: `${provider}_VIRTUAL_ACCOUNT_DEPOSIT_CREDITED`,
            targetType: 'Transaction',
            targetId: transaction.id,
            reference: event.providerReference,
            before: {
              walletBalance: creditResult.balanceBefore.toFixed(2),
            },
            after: {
              walletBalance: creditResult.balanceAfter.toFixed(2),
              transactionStatus: 'SUCCESS',
            },
            metadata: {
              provider,
              providerEventId: providerEvent.id,
              walletId: creditResult.walletId,
              amount: event.amount.toFixed(2),
              currency: event.currency,
            },
          },
        });

        return { received: true, processed: true };
      });

      return result;
    } catch (error) {
      const allocation = await this.prisma.exchangeDepositAllocation.findUnique(
        { where: { reference: event.providerReference.trim().toUpperCase() } },
      );
      if (allocation?.settlementId === `funding:${providerEvent.id}`) {
        return { received: true, processed: false, duplicate: true };
      }
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
    if (normalized !== 'MONNIFY' && normalized !== 'PAYSTACK') {
      throw new BadRequestException('Unsupported provider');
    }
    return normalized;
  }

  private async provisionWithProvider(
    provider: BankingProviderName,
    input: ProvisionVirtualAccountInput,
  ): Promise<ProviderVirtualAccount> {
    if (provider === 'paystack') {
      if (!this.paystack)
        throw new ServiceUnavailableException('Paystack is not configured');
      return this.paystack.provisionVirtualAccount(input);
    }
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
      if (document.type === 'BVN' && !identifiers.bvn && document.idNumber) {
        identifiers.bvn = this.decryptStoredKycIdentifier(document.idNumber);
      }

      if (document.type === 'NIN' && !identifiers.nin && document.idNumber) {
        identifiers.nin = this.decryptStoredKycIdentifier(document.idNumber);
      }
    }

    for (const type of ['bvn', 'nin'] as const) {
      if (
        explicitIdentifiers[type] &&
        explicitIdentifiers[type] !== identifiers[type]
      ) {
        throw new ForbiddenException(
          'Use the identity details already verified on your account',
        );
      }
    }
    if (
      !this.canUseSandboxKycBypass() &&
      !identifiers.bvn &&
      !identifiers.nin
    ) {
      throw new ForbiddenException('A verified NIN or BVN is required');
    }
    return identifiers;
  }

  private resolveMonnifyLimitProfileCode(tier: 'TIER_1' | 'TIER_2') {
    const key =
      tier === 'TIER_2'
        ? 'MONNIFY_TIER_2_LIMIT_PROFILE_CODE'
        : 'MONNIFY_TIER_1_LIMIT_PROFILE_CODE';
    const code = this.configService.get<string>(key)?.trim();
    const isProduction =
      this.configService.get<string>('NODE_ENV', 'development') ===
      'production';
    if (isProduction && !code) {
      throw new BadRequestException(
        `Monnify ${formatKycTier(tier)} limit profile is not configured`,
      );
    }
    return code || undefined;
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
      'paystack',
    );

    if (configured === 'monnify' || configured === 'paystack') {
      return configured;
    }

    throw new BadRequestException('Unsupported virtual account provider');
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
