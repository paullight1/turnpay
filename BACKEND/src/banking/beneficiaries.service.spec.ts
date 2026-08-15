import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BeneficiariesService } from './beneficiaries.service';

describe('BeneficiariesService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    bankAccount: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const monnifyBanks = {
    resolveBankAccount: jest.fn(),
    listBanks: jest.fn(),
  };

  const config = {
    get: jest.fn((key: string) =>
      key === 'BANK_ACCOUNT_ENCRYPTION_KEY'
        ? 'test-bank-account-encryption-key'
        : undefined,
    ),
  };

  let service: BeneficiariesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    service = new BeneficiariesService(
      prisma as any,
      monnifyBanks as any,
      config as unknown as ConfigService,
    );
  });

  it('resolves and saves a beneficiary with encrypted and masked account number', async () => {
    monnifyBanks.resolveBankAccount.mockResolvedValue({
      accountName: 'ADA LOVELACE',
      bankName: 'Test Bank',
    });
    prisma.bankAccount.create.mockResolvedValue({
      id: 'beneficiary-1',
      bankName: 'Test Bank',
      bankCode: '044',
      accountName: 'ADA LOVELACE',
      accountNumberMasked: '******7890',
      currency: 'NGN',
      provider: 'MONNIFY',
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.createBeneficiary('user-1', {
      accountNumber: '01234567890',
      bankCode: '044',
      bankName: 'Test Bank',
      currency: 'NGN',
      provider: 'monnify',
    });

    expect(prisma.bankAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        provider: 'MONNIFY',
        bankName: 'Test Bank',
        accountName: 'ADA LOVELACE',
        accountNumberMasked: '*******7890',
        accountNumberEncrypted: expect.not.stringContaining('01234567890'),
      }),
      select: expect.any(Object),
    });
    expect(result.accountNumberMasked).toBe('******7890');
  });

  it('never returns encrypted account numbers when listing beneficiaries', async () => {
    prisma.bankAccount.findMany.mockResolvedValue([
      {
        id: 'beneficiary-1',
        bankName: 'Test Bank',
        bankCode: '044',
        accountName: 'ADA LOVELACE',
        accountNumberMasked: '******7890',
        currency: 'NGN',
        provider: 'MONNIFY',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.getBeneficiaries('user-1');

    expect(prisma.bankAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          accountNumberEncrypted: true,
        }),
      }),
    );
    expect(result[0]).not.toHaveProperty('accountNumberEncrypted');
  });

  it('requires an encryption key before saving account numbers', async () => {
    config.get.mockReturnValueOnce(undefined);

    await expect(
      service.createBeneficiary('user-1', {
        accountNumber: '01234567890',
        bankCode: '044',
        bankName: 'Test Bank',
        currency: 'NGN',
        provider: 'monnify',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires verified KYC before saving a beneficiary', async () => {
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'PENDING',
      isSuspended: false,
    });

    await expect(
      service.createBeneficiary('user-1', {
        accountNumber: '01234567890',
        bankCode: '044',
        bankName: 'Test Bank',
        currency: 'NGN',
        provider: 'monnify',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
