import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSensitiveValue } from '../common/utils/encryption';
import { maskAccountNumber } from '../common/utils/masking';
import { formatKycTier, isKycTierAtLeast } from '../common/utils/kyc-tier';
import { CreateBeneficiaryDto, ResolveBankAccountDto } from './dto/banking.dto';
import { MonnifyVirtualAccountProvider } from './providers/monnify-virtual-account.provider';

type ResolvedBankAccount = {
  accountName: string;
  bankName?: string;
  bankCode?: string;
};

@Injectable()
export class BeneficiariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monnifyBanks: MonnifyVirtualAccountProvider,
    private readonly configService: ConfigService,
  ) {}

  listBanks() {
    return this.monnifyBanks.listBanks();
  }

  resolveBankAccount(dto: ResolveBankAccountDto): Promise<ResolvedBankAccount> {
    return this.monnifyBanks.resolveBankAccount(
      dto.accountNumber,
      dto.bankCode,
    );
  }

  async createBeneficiary(userId: string, dto: CreateBeneficiaryDto) {
    const encryptionKey = this.getEncryptionKey();
    await this.assertCanManageBeneficiary(userId);
    const provider = dto.provider || 'monnify';
    const resolved = await this.resolveBankAccount(dto);

    return this.prisma.bankAccount.create({
      data: {
        userId,
        provider: this.normalizeProvider(provider),
        bankCode: dto.bankCode,
        bankName: resolved.bankName || dto.bankName,
        accountName: resolved.accountName,
        accountNumberEncrypted: encryptSensitiveValue(
          dto.accountNumber,
          encryptionKey,
        ),
        accountNumberMasked: maskAccountNumber(dto.accountNumber),
        currency: dto.currency,
      },
      select: this.beneficiarySelect,
    });
  }

  getBeneficiaries(userId: string) {
    return this.prisma.bankAccount.findMany({
      where: {
        userId,
        isDeleted: false,
      },
      select: this.beneficiarySelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteBeneficiary(userId: string, beneficiaryId: string) {
    const deleted = await this.prisma.bankAccount.updateMany({
      where: {
        id: beneficiaryId,
        userId,
        isDeleted: false,
      },
      data: { isDeleted: true },
    });

    if (deleted.count !== 1) {
      throw new NotFoundException('Beneficiary not found');
    }

    return { deleted: true };
  }

  private getEncryptionKey() {
    const key =
      this.configService.get<string>('BANK_ACCOUNT_ENCRYPTION_KEY') ||
      this.configService.get<string>('PII_ENCRYPTION_KEY');

    if (!key) {
      throw new BadRequestException(
        'Sensitive data encryption key is not configured',
      );
    }

    return key;
  }

  private async assertCanManageBeneficiary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('Account is suspended');
    }

    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException('KYC verification is required');
    }

    if (!isKycTierAtLeast(user.kycTier, 'TIER_2')) {
      throw new ForbiddenException(
        `KYC ${formatKycTier('TIER_2')} is required to manage beneficiaries`,
      );
    }
  }

  private normalizeProvider(provider: string): 'MONNIFY' {
    const normalized = provider.toUpperCase();
    if (normalized !== 'MONNIFY') {
      throw new BadRequestException('Unsupported provider');
    }
    return 'MONNIFY';
  }

  private readonly beneficiarySelect = {
    id: true,
    bankCode: true,
    bankName: true,
    accountName: true,
    accountNumberMasked: true,
    currency: true,
    provider: true,
    isDeleted: true,
    createdAt: true,
    updatedAt: true,
  } as const;
}
