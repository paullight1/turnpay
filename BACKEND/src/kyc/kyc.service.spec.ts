import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { KycVerificationProvider } from '@prisma/client';
import { createHash } from 'crypto';
import { KycService } from './kyc.service';
import { KycProviderDefinitiveFailure } from './providers/kyc-provider.gateway';

describe('KycService', () => {
  const paystackFingerprint = (
    bvn = '12345678901',
    accountNumber = '0123456789',
    bankCode = '058',
    firstName = 'Ada',
    lastName = 'Okafor',
  ) =>
    createHash('sha256')
      .update(
        [bvn, accountNumber, bankCode, firstName, lastName]
          .map((value) => value.trim().toUpperCase())
          .join('|'),
      )
      .digest('hex');

  const prisma = {
    kycDocument: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    kycVerification: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    paystackCustomer: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    dispute: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    transaction: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const config = {
    get: jest.fn((key: string): string | undefined =>
      key === 'PII_ENCRYPTION_KEY'
        ? 'test-pii-key-with-enough-entropy'
        : undefined,
    ),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  const supabase = {
    createSignedUploadUrl: jest.fn(),
    createSignedReadUrl: jest.fn(),
    getAdminClient: jest.fn(),
  };

  const kycProviderGateway = {
    provider: 'MONNIFY',
    verifyIdentity: jest.fn(),
  };
  const bankingService = {
    provisionVirtualAccount: jest.fn(),
  };

  let service: KycService;

  beforeEach(() => {
    jest.clearAllMocks();
    kycProviderGateway.provider = 'MONNIFY';
    prisma.$transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return input(prisma);
      }

      return Promise.all(input as Promise<unknown>[]);
    });
    supabase.createSignedUploadUrl.mockResolvedValue({
      token: 'upload-token',
      signedUrl: 'https://storage.example/upload/sign/kyc-1',
    });
    supabase.createSignedReadUrl.mockResolvedValue(
      'https://storage.example/read/sign/kyc-1',
    );
    supabase.getAdminClient.mockReturnValue({
      storage: {
        from: jest.fn().mockReturnValue({
          info: jest.fn().mockResolvedValue({
            data: { size: 1024, contentType: 'application/pdf' },
            error: null,
          }),
        }),
      },
    });
    kycProviderGateway.verifyIdentity.mockResolvedValue({
      provider: 'MONNIFY',
      status: 'VERIFIED',
      reference: 'monnify-verification-1',
      checks: {
        country: 'NG',
        documentType: 'BVN',
        providerStatus: 'found',
        identifierMasked: '*******8901',
      },
      responseHash: 'monnify-response-hash',
    });
    bankingService.provisionVirtualAccount.mockResolvedValue({
      currency: 'NGN',
      status: 'ACTIVE',
      accountNumberMasked: '******1234',
    });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    service = new KycService(
      prisma as any,
      config as any,
      logger as any,
      supabase as any,
      kycProviderGateway as any,
      bankingService as any,
    );
  });

  it('creates signed upload URLs without accepting client-controlled paths', async () => {
    const result = await service.createDocumentUploadUrl('user-1', {
      fileName: 'passport.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
    });

    expect(result.bucket).toBe('kyc-documents');
    expect(result.objectKey).toMatch(/^kyc\/user-1\/\d+-.*\.pdf$/);
    expect(result.token).toBe('upload-token');
    expect(supabase.createSignedUploadUrl).toHaveBeenCalledWith(
      'kyc-documents',
      result.objectKey,
    );
  });

  it('verifies a consented identity through Monnify and promotes the KYC tier transactionally', async () => {
    prisma.kycDocument.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    }));
    prisma.kycDocument.findMany.mockResolvedValue([{ type: 'NIN' }]);
    prisma.kycVerification.create.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.verifyIdentity('user-1', {
      country: 'NG',
      type: 'NIN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      consentAccepted: true,
    });

    expect(kycProviderGateway.verifyIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        country: 'NG',
        type: 'NIN',
        identifier: '12345678901',
        identifierMasked: '*******8901',
        consentAccepted: true,
        validation: {
          firstName: 'Ada',
          lastName: 'Okafor',
          dateOfBirth: '1990-01-02',
        },
      }),
    );
    expect(prisma.kycDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'NIN',
        documentUrl: null,
        idNumber: expect.stringMatching(/^enc:v1:/),
        status: 'PENDING',
      }),
    });
    expect(prisma.kycVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'MONNIFY',
        status: 'PENDING',
        reference: expect.stringMatching(/^pending:/),
        consentRecordedAt: expect.any(Date),
        consentVersion: 'monnify-identity-and-account-setup-consent-v2',
        consentSource: 'WEB_OR_MOBILE',
      }),
    });
    expect(prisma.kycVerification.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: expect.objectContaining({
        status: 'VERIFIED',
        reference: 'monnify-verification-1',
        responseHash: 'monnify-response-hash',
      }),
    });
    expect(prisma.kycDocument.create.mock.invocationCallOrder[0]).toBeLessThan(
      kycProviderGateway.verifyIdentity.mock.invocationCallOrder[0],
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kycStatus: 'VERIFIED', kycTier: 'TIER_1' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'KYC_PROVIDER_RESULT',
        reference: 'monnify-verification-1',
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'MONNIFY',
        verificationStatus: 'VERIFIED',
        reference: 'monnify-verification-1',
        idNumber: '*******8901',
        kycTier: 'TIER_1',
        accountProvisioning: expect.objectContaining({ status: 'READY' }),
      }),
    );
    expect(bankingService.provisionVirtualAccount).toHaveBeenCalledWith(
      'user-1',
      { currency: 'NGN', provider: 'monnify' },
    );
  });

  it('forwards date of birth to Monnify without persisting it', async () => {
    kycProviderGateway.provider = 'MONNIFY';
    kycProviderGateway.verifyIdentity.mockResolvedValueOnce({
      provider: 'MONNIFY',
      status: 'VERIFIED',
      reference: 'monnify-verification-2',
      checks: {
        country: 'NG',
        documentType: 'NIN',
        providerStatus: 'found',
        identifierMasked: '*******8901',
      },
      responseHash: 'monnify-response-hash-2',
    });
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    }));
    prisma.kycDocument.findMany.mockResolvedValue([{ type: 'NIN' }]);
    prisma.kycVerification.create.mockResolvedValue({});
    prisma.kycVerification.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await service.verifyIdentity('user-1', {
      country: 'NG',
      type: 'NIN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      consentAccepted: true,
      firstName: 'Ada',
      lastName: 'Okafor',
    } as any);

    expect(prisma.kycVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'MONNIFY' }),
    });
    expect(kycProviderGateway.verifyIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        validation: expect.objectContaining({
          firstName: 'Ada',
          lastName: 'Okafor',
          dateOfBirth: '1990-01-02',
        }),
      }),
    );
    expect(
      JSON.stringify(prisma.kycVerification.create.mock.calls),
    ).not.toContain('1990-01-02');
  });

  it('keeps verified KYC when Monnify account preparation needs a retry', async () => {
    prisma.kycDocument.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    }));
    prisma.kycDocument.findMany.mockResolvedValue([{ type: 'NIN' }]);
    prisma.kycVerification.create.mockResolvedValue({});
    prisma.kycVerification.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    bankingService.provisionVirtualAccount.mockRejectedValueOnce(
      new Error('Monnify account service unavailable'),
    );

    const result = await service.verifyIdentity('user-1', {
      country: 'NG',
      type: 'NIN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      consentAccepted: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        verificationStatus: 'VERIFIED',
        accountProvisioning: { status: 'PENDING' },
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kycStatus: 'VERIFIED', kycTier: 'TIER_1' },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', errorName: 'Error' }),
      'KYC is verified; Monnify account preparation will need a retry',
    );
  });

  it('submits Paystack BVN verification as pending and does not provision early', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    kycProviderGateway.verifyIdentity.mockResolvedValue({
      provider: 'PAYSTACK',
      status: 'PENDING',
      reference: 'paystack:customer:CUS_fixture123:verification:document-1',
      checks: {
        customerCode: 'CUS_fixture123',
        accountSetupConsent: true,
        identifierMasked: '*******8901',
      },
      responseHash: 'paystack-response-hash',
    });
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      phone: '+2348012345678',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.kycVerification.create.mockResolvedValue({});
    prisma.kycDocument.update.mockResolvedValue({});
    prisma.kycVerification.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.verifyIdentity('user-1', {
      country: 'NG',
      type: 'BVN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      bankCode: '058',
      accountNumber: '0123456789',
      accountSetupConsent: true,
      consentAccepted: true,
    });

    expect(kycProviderGateway.verifyIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BVN',
        validation: expect.objectContaining({
          bankCode: '058',
          accountNumber: '0123456789',
          accountSetupConsent: true,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'PAYSTACK',
        verificationStatus: 'PENDING',
        accountProvisioning: { status: 'NOT_REQUIRED' },
      }),
    );
    expect(bankingService.provisionVirtualAccount).not.toHaveBeenCalled();
  });

  it('preserves a NIN tier earned while the Paystack request was in flight', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    const profile = {
      fullName: 'Ada Okafor',
      phone: '+2348012345678',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    };
    prisma.user.findUnique.mockResolvedValue(profile);
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      ...data,
    }));
    prisma.kycVerification.findUnique.mockResolvedValue({ status: 'PENDING' });
    kycProviderGateway.verifyIdentity.mockImplementation(async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...profile,
        kycTier: 'TIER_1',
        kycStatus: 'VERIFIED',
      });
      return {
        provider: 'PAYSTACK',
        status: 'PENDING',
        reference: 'paystack-delayed',
        checks: {},
        responseHash: 'safe-hash',
      };
    });
    const result = await service.verifyIdentity('user-1', {
      country: 'NG',
      type: 'BVN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      bankCode: '058',
      accountNumber: '0123456789',
      consentAccepted: true,
    });
    expect(result.kycTier).toBe('TIER_1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kycTier: 'TIER_1', kycStatus: 'VERIFIED' },
    });
  });

  it('closes only the matching Paystack attempt after a definitive validation rejection', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    const validationFingerprint = paystackFingerprint();
    const definitiveFailure = new KycProviderDefinitiveFailure(
      KycVerificationProvider.PAYSTACK,
      'Paystack identity validation was rejected',
      validationFingerprint,
    );
    const boundCustomer = {
      customerCode: 'CUS_fixture123',
      validationFingerprint,
      validationStatus: 'PENDING',
    };

    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      phone: '+2348012345678',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.paystackCustomer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(boundCustomer);
    prisma.kycVerification.findFirst.mockResolvedValue(null);
    prisma.kycVerification.findUnique.mockResolvedValueOnce({
      status: 'PENDING',
      checks: { validationFingerprint },
    });
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.kycVerification.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.kycDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.paystackCustomer.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});
    kycProviderGateway.verifyIdentity.mockRejectedValueOnce(definitiveFailure);

    await expect(
      service.verifyIdentity('user-1', {
        country: 'NG',
        type: 'BVN',
        idNumber: '12345678901',
        dateOfBirth: '1990-01-02',
        bankCode: '058',
        accountNumber: '0123456789',
        accountSetupConsent: true,
        consentAccepted: true,
      }),
    ).rejects.toBe(definitiveFailure);

    const verificationId =
      prisma.kycVerification.create.mock.calls[0][0].data.id;
    const documentId = prisma.kycDocument.create.mock.calls[0][0].data.id;
    expect(prisma.kycVerification.updateMany).toHaveBeenCalledWith({
      where: { id: verificationId, status: 'PENDING' },
      data: {
        status: 'FAILED',
        errorMessage:
          'Identity details were rejected. Review your details and try again.',
      },
    });
    expect(prisma.kycDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: documentId,
        status: { in: ['PENDING', 'SUBMITTED'] },
      },
      data: {
        status: 'REJECTED',
        rejectionNote:
          'Identity details were rejected. Review your details and try again.',
      },
    });
    expect(prisma.paystackCustomer.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        validationFingerprint,
        validationStatus: { not: 'VERIFIED' },
      },
      data: { validationStatus: 'FAILED' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'KYC_PROVIDER_FAILURE',
        targetId: verificationId,
        metadata: expect.objectContaining({
          failureClass: 'DEFINITIVE_VALIDATION_REJECTION',
        }),
      }),
    });
  });

  it('leaves Paystack attempts pending after an ambiguous provider failure', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      phone: '+2348012345678',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.paystackCustomer.findUnique.mockResolvedValue(null);
    prisma.kycVerification.findFirst.mockResolvedValue(null);
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.kycVerification.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.auditLog.create.mockResolvedValue({});
    const ambiguousFailure = new ServiceUnavailableException(
      'Paystack confirmation is unavailable',
    );
    kycProviderGateway.verifyIdentity.mockRejectedValueOnce(ambiguousFailure);

    await expect(
      service.verifyIdentity('user-1', {
        country: 'NG',
        type: 'BVN',
        idNumber: '12345678901',
        dateOfBirth: '1990-01-02',
        bankCode: '058',
        accountNumber: '0123456789',
        accountSetupConsent: true,
        consentAccepted: true,
      }),
    ).rejects.toBe(ambiguousFailure);

    expect(prisma.kycVerification.findUnique).not.toHaveBeenCalled();
    expect(prisma.kycVerification.updateMany).not.toHaveBeenCalled();
    expect(prisma.kycDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.paystackCustomer.updateMany).not.toHaveBeenCalled();
    expect(prisma.kycDocument.update).not.toHaveBeenCalled();
    expect(prisma.kycVerification.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        documentType: 'BVN',
      }),
      'KYC attempt remains pending after ambiguous provider failure',
    );
  });

  it('does not downgrade a Paystack attempt finalized by a successful webhook', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    const validationFingerprint = paystackFingerprint();
    const definitiveFailure = new KycProviderDefinitiveFailure(
      KycVerificationProvider.PAYSTACK,
      'Paystack identity validation was rejected',
      validationFingerprint,
    );

    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      phone: '+2348012345678',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.paystackCustomer.findUnique.mockResolvedValue(null);
    prisma.kycVerification.findFirst.mockResolvedValue(null);
    prisma.kycVerification.findUnique.mockResolvedValueOnce({
      status: 'VERIFIED',
      checks: { validationFingerprint, verified: true },
    });
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.kycVerification.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.auditLog.create.mockResolvedValue({});
    kycProviderGateway.verifyIdentity.mockRejectedValueOnce(definitiveFailure);

    await expect(
      service.verifyIdentity('user-1', {
        country: 'NG',
        type: 'BVN',
        idNumber: '12345678901',
        dateOfBirth: '1990-01-02',
        bankCode: '058',
        accountNumber: '0123456789',
        accountSetupConsent: true,
        consentAccepted: true,
      }),
    ).rejects.toBe(definitiveFailure);

    expect(prisma.kycVerification.updateMany).not.toHaveBeenCalled();
    expect(prisma.kycDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.paystackCustomer.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'KYC_CONSENT_RECORDED' }),
    });
  });

  it('reuses the canonical failed Paystack attempt for a same-identity retry', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    const validationFingerprint = paystackFingerprint();
    let binding: {
      customerCode: string;
      validationFingerprint: string;
      validationStatus: string;
    } | null = null;
    let createdDocument: Record<string, unknown> | undefined;
    let createdVerification: Record<string, unknown> | undefined;
    const retryState: { failedAttempt?: Record<string, unknown> } = {};

    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      phone: '+2348012345678',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.paystackCustomer.findUnique.mockImplementation(async () => binding);
    prisma.kycVerification.findFirst.mockResolvedValue(null);
    prisma.kycVerification.findMany.mockImplementation(async () =>
      retryState.failedAttempt ? [retryState.failedAttempt] : [],
    );
    prisma.kycDocument.create.mockImplementation(async ({ data }) => {
      createdDocument = { id: data.id, ...data };
      return createdDocument;
    });
    prisma.kycVerification.create.mockImplementation(async ({ data }) => {
      createdVerification = { id: data.id, ...data };
      return createdVerification;
    });
    prisma.kycDocument.update.mockImplementation(async ({ where, data }) => ({
      ...(createdDocument ?? {}),
      id: where.id,
      ...data,
    }));
    prisma.kycVerification.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    kycProviderGateway.verifyIdentity.mockImplementationOnce(async () => {
      binding = {
        customerCode: 'CUS_fixture123',
        validationFingerprint,
        validationStatus: 'PENDING',
      };
      throw new BadRequestException('Paystack rejected the identity');
    });

    const dto = {
      country: 'NG' as const,
      type: 'BVN' as const,
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      bankCode: '058',
      accountNumber: '0123456789',
      consentAccepted: true as const,
      accountSetupConsent: true,
    };

    await expect(service.verifyIdentity('user-1', dto)).rejects.toThrow(
      'Paystack rejected the identity',
    );

    retryState.failedAttempt = {
      id: createdVerification?.id,
      documentId: createdDocument?.id,
      status: 'FAILED',
      checks: {
        customerCode: 'CUS_fixture123',
        validationFingerprint,
        accountSetupConsent: true,
      },
      document: {
        ...(createdDocument ?? {}),
        status: 'REJECTED',
      },
    };
    kycProviderGateway.verifyIdentity.mockResolvedValueOnce({
      provider: 'PAYSTACK',
      status: 'PENDING',
      reference: 'paystack:customer:CUS_fixture123:verification:canonical',
      checks: {
        customerCode: 'CUS_fixture123',
        validationFingerprint,
        accountSetupConsent: true,
      },
      responseHash: 'paystack-retry-hash',
    });

    const result = await service.verifyIdentity('user-1', dto);

    expect(prisma.kycDocument.create).toHaveBeenCalledTimes(1);
    expect(prisma.kycVerification.create).toHaveBeenCalledTimes(1);
    expect(kycProviderGateway.verifyIdentity).toHaveBeenCalledTimes(2);
    expect(kycProviderGateway.verifyIdentity.mock.calls[1][0].documentId).toBe(
      createdDocument?.id,
    );
    expect(prisma.kycDocument.update).toHaveBeenCalledWith({
      where: { id: createdDocument?.id },
      data: expect.objectContaining({ status: 'PENDING' }),
    });
    expect(prisma.kycVerification.update).toHaveBeenCalledWith({
      where: { id: createdVerification?.id },
      data: expect.objectContaining({ status: 'PENDING' }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'KYC_CONSENT_RECORDED',
        targetId: createdVerification?.id,
        metadata: expect.objectContaining({
          retry: true,
          reusedCanonicalAttempt: true,
        }),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'PAYSTACK',
        verificationStatus: 'PENDING',
      }),
    );
  });

  it('rejects Paystack revalidation after the customer binding is verified', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      phone: '+2348012345678',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
    });
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      customerCode: 'CUS_fixture123',
      validationFingerprint: paystackFingerprint(),
      validationStatus: 'VERIFIED',
    });

    await expect(
      service.verifyIdentity('user-1', {
        country: 'NG',
        type: 'BVN',
        idNumber: '12345678901',
        dateOfBirth: '1990-01-02',
        bankCode: '058',
        accountNumber: '0123456789',
        consentAccepted: true,
      }),
    ).rejects.toThrow('identity verification is already complete');
    expect(prisma.kycDocument.create).not.toHaveBeenCalled();
    expect(kycProviderGateway.verifyIdentity).not.toHaveBeenCalled();
  });

  it('does not overwrite a Paystack success callback that wins the provider response race', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    prisma.paystackCustomer.findUnique.mockResolvedValue(null);
    kycProviderGateway.verifyIdentity.mockImplementation(async () => {
      prisma.kycVerification.findUnique.mockResolvedValue({
        status: 'VERIFIED',
        reference: 'callback-reference',
        checks: { customerCode: 'CUS_fixture123', verified: true },
      });
      prisma.kycDocument.findUnique.mockResolvedValue({
        status: 'VERIFIED',
        rejectionNote: null,
      });
      return {
        provider: 'PAYSTACK',
        status: 'PENDING',
        reference: 'request-reference',
        checks: { customerCode: 'CUS_fixture123' },
        responseHash: 'request-hash',
      };
    });
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      phone: '+2348012345678',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.kycVerification.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.verifyIdentity('user-1', {
      country: 'NG',
      type: 'BVN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      bankCode: '058',
      accountNumber: '0123456789',
      consentAccepted: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        verificationStatus: 'VERIFIED',
        reference: 'callback-reference',
      }),
    );
    expect(prisma.kycVerification.update).not.toHaveBeenCalled();
  });

  it('completes a Paystack identification callback once and provisions only after success', async () => {
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      userId: 'user-1',
      customerCode: 'CUS_fixture123',
      validationFingerprint: 'fingerprint-1',
      validationStatus: 'PENDING',
    });
    prisma.kycVerification.findMany.mockResolvedValue([
      {
        id: 'verification-1',
        documentId: 'document-1',
        reference: 'paystack:customer:CUS_fixture123:verification:document-1',
        status: 'PENDING',
        checks: {
          customerCode: 'CUS_fixture123',
          validationFingerprint: 'fingerprint-1',
          accountSetupConsent: true,
        },
        document: { id: 'document-1', status: 'SUBMITTED' },
      },
    ]);
    prisma.kycVerification.findUnique.mockResolvedValue({
      status: 'PENDING',
      reference: 'paystack:customer:CUS_fixture123:verification:document-1',
      checks: {
        customerCode: 'CUS_fixture123',
        validationFingerprint: 'fingerprint-1',
        accountSetupConsent: true,
      },
    });
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.kycDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.kycDocument.findMany.mockResolvedValue([{ type: 'BVN' }]);
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'SUBMITTED',
      kycTier: 'TIER_0',
    });
    prisma.user.update.mockResolvedValue({});
    prisma.paystackCustomer.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});
    bankingService.provisionVirtualAccount.mockResolvedValue({
      accountNumberMasked: '******1234',
      bankName: 'Paystack-Titan',
      status: 'ACTIVE',
    });

    const result = await service.processPaystackIdentification(
      'customeridentification.success',
      { customer_code: 'CUS_fixture123' },
    );

    expect(result).toEqual(
      expect.objectContaining({ processed: true, status: 'VERIFIED' }),
    );
    expect(prisma.kycVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'verification-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'VERIFIED' }),
      }),
    );
    expect(bankingService.provisionVirtualAccount).toHaveBeenCalledWith(
      'user-1',
      { currency: 'NGN', provider: 'paystack' },
    );
  });

  it.each([
    ['missing fingerprint', { customerCode: 'CUS_fixture123' }],
    [
      'different fingerprint',
      {
        customerCode: 'CUS_fixture123',
        validationFingerprint: 'not-the-bound-fingerprint',
      },
    ],
  ])(
    'ignores a Paystack callback with a %s instead of approving the pending record',
    async (_label, checks) => {
      prisma.paystackCustomer.findUnique.mockResolvedValue({
        userId: 'user-1',
        customerCode: 'CUS_fixture123',
        validationFingerprint: 'bound-fingerprint',
        validationStatus: 'PENDING',
      });
      prisma.kycVerification.findMany.mockResolvedValue([
        {
          id: 'verification-stale',
          documentId: 'document-stale',
          reference: 'stale-reference',
          status: 'PENDING',
          checks,
          document: { id: 'document-stale', status: 'PENDING' },
        },
      ]);

      const result = await service.processPaystackIdentification(
        'customeridentification.success',
        { customer_code: 'CUS_fixture123' },
      );

      expect(result).toEqual(
        expect.objectContaining({
          received: true,
          processed: false,
          ignored: true,
        }),
      );
      expect(prisma.kycVerification.updateMany).not.toHaveBeenCalled();
      expect(bankingService.provisionVirtualAccount).not.toHaveBeenCalled();
    },
  );

  it('does not downgrade a verified Paystack binding on a late failed callback', async () => {
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      userId: 'user-1',
      customerCode: 'CUS_fixture123',
      validationFingerprint: 'bound-fingerprint',
      validationStatus: 'VERIFIED',
    });
    prisma.kycVerification.findMany.mockResolvedValue([
      {
        id: 'verification-late',
        documentId: 'document-late',
        reference: 'late-reference',
        status: 'PENDING',
        checks: {
          customerCode: 'CUS_fixture123',
          validationFingerprint: 'bound-fingerprint',
        },
        document: { id: 'document-late', status: 'PENDING' },
      },
    ]);
    prisma.kycVerification.findUnique.mockResolvedValue({
      status: 'PENDING',
      reference: 'late-reference',
      checks: {
        customerCode: 'CUS_fixture123',
        validationFingerprint: 'bound-fingerprint',
      },
    });
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.kycDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
    });
    prisma.user.update.mockResolvedValue({});
    prisma.paystackCustomer.updateMany.mockResolvedValue({ count: 0 });
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.processPaystackIdentification(
      'customeridentification.failed',
      { customer_code: 'CUS_fixture123', reason: 'late failure' },
    );

    expect(result).toEqual(
      expect.objectContaining({ processed: true, status: 'FAILED' }),
    );
    expect(prisma.paystackCustomer.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        validationStatus: { not: 'VERIFIED' },
      },
      data: { validationStatus: 'FAILED' },
    });
    expect(prisma.paystackCustomer.update).not.toHaveBeenCalled();
  });

  it('registers an owned NIN document for manual review without exposing the identifier', async () => {
    prisma.kycDocument.findFirst.mockResolvedValue(null);
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
    }));
    prisma.kycVerification.create.mockResolvedValue({});
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.createManualKycDocument('user-1', {
      type: 'NIN',
      idNumber: '12345678901',
      objectKey: 'kyc/user-1/nin.pdf',
      consentAccepted: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'MANUAL_REVIEW',
        manualReviewRequired: true,
        idNumber: '*******8901',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('12345678901');
    expect(supabase.getAdminClient).toHaveBeenCalled();
    const storageBucket =
      supabase.getAdminClient().storage.from.mock.results[0].value;
    expect(storageBucket.info).toHaveBeenCalledWith('kyc/user-1/nin.pdf');
  });

  it.each([
    [
      'an oversized upload',
      { size: 8 * 1024 * 1024 + 1, contentType: 'application/pdf' },
    ],
    [
      'an unsupported MIME type',
      { size: 1024, contentType: 'application/octet-stream' },
    ],
  ])(
    'rejects manual KYC registration for %s based on actual storage metadata',
    async (_label, metadata) => {
      const storageBucket = supabase
        .getAdminClient()
        .storage.from('kyc-documents');
      storageBucket.info.mockResolvedValue({ data: metadata, error: null });

      await expect(
        service.createManualKycDocument('user-1', {
          type: 'NIN',
          idNumber: '12345678901',
          objectKey: 'kyc/user-1/nin.pdf',
          consentAccepted: true,
        }),
      ).rejects.toThrow('Uploaded identity document could not be found');
      expect(prisma.kycDocument.create).not.toHaveBeenCalled();
    },
  );

  it('exposes Paystack customer validation status without changing legacy status reads', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      fullName: 'Ada Okafor',
      kycStatus: 'SUBMITTED',
      kycTier: 'TIER_1',
    });
    prisma.kycDocument.findMany.mockResolvedValue([]);
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      validationStatus: 'PENDING',
    });

    const result = await service.getUserKycStatus('user-1');

    expect(result.provider).toBe('PAYSTACK');
    expect(result.providerValidationStatus).toBe('PENDING');
    expect(prisma.paystackCustomer.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { validationStatus: true },
    });
  });

  it('defaults Paystack customer validation status when no binding exists', async () => {
    kycProviderGateway.provider = 'PAYSTACK';
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      fullName: 'Ada Okafor',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
    });
    prisma.kycDocument.findMany.mockResolvedValue([]);
    prisma.paystackCustomer.findUnique.mockResolvedValue(null);

    const result = await service.getUserKycStatus('user-1');

    expect(result.providerValidationStatus).toBe('UNVERIFIED');
  });

  it('releases a reserved KYC attempt when Monnify is unavailable', async () => {
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      ...data,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    }));
    prisma.kycVerification.create.mockImplementation(async ({ data }) => ({
      id: 'verification-reserved',
      ...data,
    }));
    prisma.kycDocument.update.mockResolvedValue({});
    prisma.kycVerification.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    kycProviderGateway.verifyIdentity.mockRejectedValue(
      new Error('provider unavailable'),
    );

    await expect(
      service.verifyIdentity('user-1', {
        country: 'NG',
        type: 'NIN',
        idNumber: '12345678901',
        dateOfBirth: '1990-01-02',
        consentAccepted: true,
      }),
    ).rejects.toThrow('provider unavailable');

    expect(prisma.kycDocument.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: expect.objectContaining({
        status: 'REJECTED',
        rejectionNote: 'Identity verification is temporarily unavailable',
      }),
    });
    const reservedVerificationId =
      prisma.kycVerification.create.mock.calls[0][0].data.id;
    expect(prisma.kycVerification.update).toHaveBeenCalledWith({
      where: { id: reservedVerificationId },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'Identity verification is temporarily unavailable',
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'KYC_PROVIDER_FAILURE',
      }),
    });
    expect(bankingService.provisionVirtualAccount).not.toHaveBeenCalled();
  });

  it('returns a conflict when an active attempt already exists for the identity type', async () => {
    prisma.kycDocument.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.kycDocument.create.mockRejectedValue(
      Object.assign(new Error('duplicate active attempt'), { code: 'P2002' }),
    );

    await expect(
      service.verifyIdentity('user-1', {
        country: 'NG',
        type: 'NIN',
        idNumber: '12345678901',
        dateOfBirth: '1990-01-02',
        consentAccepted: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(kycProviderGateway.verifyIdentity).not.toHaveBeenCalled();
  });

  it('rejects unsupported country and identity-type pairs before persistence', async () => {
    prisma.kycDocument.create.mockResolvedValue({
      id: 'should-not-be-created',
      userId: 'user-1',
      type: 'BVN',
      documentUrl: null,
      idNumber: null,
      status: 'PENDING',
    });

    await expect(
      service.verifyIdentity('user-1', {
        country: 'GH' as never,
        type: 'BVN',
        idNumber: '12345678901',
        dateOfBirth: '1990-01-02',
        consentAccepted: true,
      }),
    ).rejects.toThrow(
      'Identity type is not supported for the selected country',
    );

    expect(prisma.kycDocument.create).not.toHaveBeenCalled();
    expect(kycProviderGateway.verifyIdentity).not.toHaveBeenCalled();
  });

  it('rejects a future date of birth before persistence or a provider call', async () => {
    kycProviderGateway.provider = 'MONNIFY';

    await expect(
      service.verifyIdentity('user-1', {
        country: 'NG',
        type: 'BVN',
        idNumber: '12345678901',
        dateOfBirth: '2999-01-01',
        consentAccepted: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.kycDocument.create).not.toHaveBeenCalled();
    expect(kycProviderGateway.verifyIdentity).not.toHaveBeenCalled();
  });

  it('requires both legal names before reserving a Monnify attempt', async () => {
    kycProviderGateway.provider = 'MONNIFY';
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });

    await expect(
      service.verifyIdentity('user-1', {
        country: 'NG',
        type: 'NIN',
        idNumber: '12345678901',
        dateOfBirth: '1990-01-02',
        consentAccepted: true,
      }),
    ).rejects.toThrow(
      'Complete your legal first and last name before identity verification',
    );

    expect(prisma.kycDocument.create).not.toHaveBeenCalled();
    expect(prisma.kycVerification.create).not.toHaveBeenCalled();
    expect(kycProviderGateway.verifyIdentity).not.toHaveBeenCalled();
  });

  it('audits admin document access when creating a signed review URL', async () => {
    prisma.kycDocument.findUnique.mockResolvedValue({
      id: 'kyc-1',
      userId: 'user-1',
      type: 'NIN',
      status: 'SUBMITTED',
      documentUrl: 'kyc/user-1/kyc-1.pdf',
    });
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.createAdminDocumentReviewUrl(
      'kyc-1',
      'admin-1',
    );

    expect(result.documentUrl).toBe('https://storage.example/read/sign/kyc-1');
    expect(supabase.createSignedReadUrl).toHaveBeenCalledWith(
      'kyc-documents',
      'kyc/user-1/kyc-1.pdf',
      300,
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-1',
        action: 'KYC_DOCUMENT_ACCESS',
        targetType: 'KycDocument',
        targetId: 'kyc-1',
      }),
    });
  });

  it('returns whitelisted provider evidence for admin review without raw PII', async () => {
    prisma.kycDocument.findMany.mockResolvedValue([
      {
        id: 'kyc-provider-1',
        userId: 'user-1',
        type: 'NIN',
        idNumber: '12345678901',
        documentUrl: null,
        status: 'SUBMITTED',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        user: {
          id: 'user-1',
          email: 'ada@example.com',
          phone: '+2348012345678',
          kycStatus: 'SUBMITTED',
          kycTier: 'TIER_1',
        },
        verifications: [
          {
            provider: 'MONNIFY',
            status: 'REVIEW_REQUIRED',
            checks: {
              providerStatus: 'found',
              allValidationPassed: false,
              dataValidation: true,
              country: 'NG',
              providerType: 'nin',
              identifierMasked: '*******8901',
              idNumber: '12345678901',
              image: 'data:image/jpeg;base64,sensitive',
            },
          },
        ],
      },
    ]);
    prisma.kycDocument.count.mockResolvedValue(1);

    const result = await service.getAllPendingKyc(1, 20);

    expect(result.documents[0]).toEqual(
      expect.objectContaining({
        reviewSource: 'PROVIDER',
        reviewEvidence: {
          provider: 'MONNIFY',
          status: 'REVIEW_REQUIRED',
          providerStatus: 'found',
          allValidationPassed: false,
          dataValidation: true,
          country: 'NG',
          providerType: 'nin',
          identifierMasked: '*******8901',
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('12345678901');
    expect(JSON.stringify(result)).not.toContain('base64');
  });

  it('refuses a completed decision discovered after the initial document read', async () => {
    const document = {
      id: 'kyc-race',
      userId: 'user-1',
      type: 'NIN',
      status: 'SUBMITTED',
      user: { id: 'user-1', kycTier: 'TIER_0', kycStatus: 'SUBMITTED' },
      verifications: [{ provider: 'MANUAL_REVIEW' }],
    };
    prisma.kycDocument.findUnique
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce({ ...document, status: 'VERIFIED' });
    prisma.kycDocument.update.mockResolvedValue({
      ...document,
      status: 'REJECTED',
    });
    await expect(
      service.reviewKyc(
        'kyc-race',
        {
          status: 'REJECTED',
          rejectionNote: 'Competing decision after first read',
        },
        'admin-1',
      ),
    ).rejects.toThrow('already reviewed');
    expect(prisma.kycDocument.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('audits admin KYC review decisions without raw identifiers', async () => {
    prisma.kycDocument.findUnique.mockResolvedValue({
      id: 'kyc-1',
      userId: 'user-1',
      type: 'NIN',
      idNumber: '12345678901',
      status: 'SUBMITTED',
      rejectionNote: null,
      reviewedBy: null,
      reviewedAt: null,
      user: { id: 'user-1', kycTier: 'TIER_0' },
    });
    prisma.kycDocument.update.mockResolvedValue({
      id: 'kyc-1',
      userId: 'user-1',
      type: 'NIN',
      idNumber: '12345678901',
      status: 'VERIFIED',
      rejectionNote: 'NIN matched profile',
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2026-05-21T00:00:00.000Z'),
    });
    prisma.kycDocument.findMany.mockResolvedValue([{ type: 'NIN' }]);
    prisma.user.update.mockResolvedValue({});
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});

    await service.reviewKyc(
      'kyc-1',
      { status: 'VERIFIED', rejectionNote: 'NIN matched profile' },
      'admin-1',
    );

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'KYC_REVIEW',
        reason: 'NIN matched profile',
        before: expect.objectContaining({ idNumber: expect.any(String) }),
        after: expect.objectContaining({ idNumber: '*******8901' }),
      }),
    });
    expect(
      JSON.stringify(prisma.auditLog.create.mock.calls[0][0]),
    ).not.toContain('12345678901');
  });

  it('does not allow admins to approve or reject automated Paystack BVN records', async () => {
    prisma.kycDocument.findUnique.mockResolvedValue({
      id: 'paystack-bvn-1',
      userId: 'user-1',
      type: 'BVN',
      idNumber: '12345678901',
      status: 'SUBMITTED',
      rejectionNote: null,
      reviewedBy: null,
      reviewedAt: null,
      user: { id: 'user-1', kycTier: 'TIER_0' },
      verifications: [{ provider: 'PAYSTACK' }],
    });

    await expect(
      service.reviewKyc(
        'paystack-bvn-1',
        { status: 'VERIFIED', rejectionNote: 'manual override' },
        'admin-1',
      ),
    ).rejects.toThrow('cannot be manually reviewed');
    expect(prisma.kycDocument.update).not.toHaveBeenCalled();
    expect(prisma.kycVerification.updateMany).not.toHaveBeenCalled();
  });

  it('promotes a verified BVN or NIN to at least tier 1', async () => {
    prisma.kycDocument.findUnique.mockResolvedValue({
      id: 'kyc-1',
      userId: 'user-1',
      type: 'BVN',
      idNumber: '12345678901',
      status: 'SUBMITTED',
      rejectionNote: null,
      reviewedBy: null,
      reviewedAt: null,
      user: { id: 'user-1', kycTier: 'TIER_0' },
    });
    prisma.kycDocument.update.mockResolvedValue({
      id: 'kyc-1',
      userId: 'user-1',
      type: 'BVN',
      idNumber: '12345678901',
      status: 'VERIFIED',
      rejectionNote: 'BVN matched profile',
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2026-05-21T00:00:00.000Z'),
    });
    prisma.kycDocument.findMany.mockResolvedValue([{ type: 'BVN' }]);
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await service.reviewKyc(
      'kyc-1',
      { status: 'VERIFIED', rejectionNote: 'BVN matched profile' },
      'admin-1',
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kycStatus: 'VERIFIED', kycTier: 'TIER_1' },
    });
  });

  it('promotes a user with verified BVN and NIN to tier 2', async () => {
    prisma.kycDocument.findUnique.mockResolvedValue({
      id: 'kyc-2',
      userId: 'user-1',
      type: 'NIN',
      idNumber: '12345678901',
      status: 'SUBMITTED',
      rejectionNote: null,
      reviewedBy: null,
      reviewedAt: null,
      user: { id: 'user-1', kycTier: 'TIER_1' },
    });
    prisma.kycDocument.update.mockResolvedValue({
      id: 'kyc-2',
      userId: 'user-1',
      type: 'NIN',
      idNumber: '12345678901',
      status: 'VERIFIED',
      rejectionNote: 'NIN matched profile',
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2026-05-21T00:00:00.000Z'),
    });
    prisma.kycDocument.findMany.mockResolvedValue([
      { type: 'BVN' },
      { type: 'NIN' },
    ]);
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await service.reviewKyc(
      'kyc-2',
      { status: 'VERIFIED', rejectionNote: 'NIN matched profile' },
      'admin-1',
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kycStatus: 'VERIFIED', kycTier: 'TIER_2' },
    });
  });

  it('promotes a Ghana user with verified passport and voter card to tier 2', async () => {
    prisma.kycDocument.findUnique.mockResolvedValue({
      id: 'kyc-gh-2',
      userId: 'user-gh',
      type: 'VOTERS_CARD',
      idNumber: 'GHA-12345',
      status: 'SUBMITTED',
      rejectionNote: null,
      reviewedBy: null,
      reviewedAt: null,
      user: { id: 'user-gh', kycTier: 'TIER_1' },
    });
    prisma.kycDocument.update.mockResolvedValue({
      id: 'kyc-gh-2',
      userId: 'user-gh',
      type: 'VOTERS_CARD',
      idNumber: 'GHA-12345',
      status: 'VERIFIED',
      rejectionNote: 'Voter card matched profile',
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2026-09-02T00:00:00.000Z'),
    });
    prisma.kycDocument.findMany.mockResolvedValue([
      { type: 'PASSPORT' },
      { type: 'VOTERS_CARD' },
    ]);
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await service.reviewKyc(
      'kyc-gh-2',
      { status: 'VERIFIED', rejectionNote: 'Voter card matched profile' },
      'admin-1',
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-gh' },
      data: { kycStatus: 'VERIFIED', kycTier: 'TIER_2' },
    });
  });

  it('does not promote rejected KYC documents', async () => {
    prisma.kycDocument.findUnique.mockResolvedValue({
      id: 'kyc-1',
      userId: 'user-1',
      type: 'BVN',
      idNumber: '12345678901',
      status: 'SUBMITTED',
      rejectionNote: null,
      reviewedBy: null,
      reviewedAt: null,
      user: { id: 'user-1', kycTier: 'TIER_0' },
    });
    prisma.kycDocument.update.mockResolvedValue({
      id: 'kyc-1',
      userId: 'user-1',
      type: 'BVN',
      idNumber: '12345678901',
      status: 'REJECTED',
      rejectionNote: 'Document mismatch',
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2026-05-21T00:00:00.000Z'),
    });
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await service.reviewKyc(
      'kyc-1',
      { status: 'REJECTED', rejectionNote: 'Document mismatch' },
      'admin-1',
    );

    expect(prisma.kycDocument.findMany).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kycStatus: 'REJECTED', kycTier: 'TIER_0' },
    });
  });
});
