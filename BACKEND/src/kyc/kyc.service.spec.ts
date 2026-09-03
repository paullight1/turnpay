import { BadRequestException, ConflictException } from '@nestjs/common';
import { KycService } from './kyc.service';

describe('KycService', () => {
  const prisma = {
    kycDocument: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    kycVerification: {
      create: jest.fn(),
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
  };

  const kycProviderGateway = {
    provider: 'YOUVERIFY',
    verifyIdentity: jest.fn(),
  };
  const youverifyProvider = {
    provider: 'YOUVERIFY',
    verifyIdentity: jest.fn(),
    verifyCallbackSignature: jest.fn(),
    normalizeCallback: jest.fn(),
  };
  const kycWebhookInbox = {
    accept: jest.fn(),
  };

  let service: KycService;

  beforeEach(() => {
    jest.clearAllMocks();
    kycProviderGateway.provider = 'YOUVERIFY';
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
    kycProviderGateway.verifyIdentity.mockResolvedValue({
      provider: 'YOUVERIFY',
      status: 'VERIFIED',
      reference: 'youverify-verification-1',
      checks: {
        country: 'NG',
        documentType: 'BVN',
        providerStatus: 'found',
        identifierMasked: '*******8901',
      },
      responseHash: 'youverify-response-hash',
    });
    youverifyProvider.verifyCallbackSignature.mockReturnValue(true);
    youverifyProvider.normalizeCallback.mockReturnValue({
      provider: 'YOUVERIFY',
      status: 'VERIFIED',
      reference: 'youverify-verification-1',
      checks: {
        providerStatus: 'found',
        allValidationPassed: true,
      },
      responseHash: 'youverify-callback-hash',
    });
    kycWebhookInbox.accept.mockResolvedValue({
      eventId: 'kyc-webhook-event-1',
      duplicate: false,
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
      youverifyProvider as any,
      kycWebhookInbox as any,
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

  it('verifies a consented identity through Youverify and promotes the KYC tier transactionally', async () => {
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
    prisma.kycDocument.findMany.mockResolvedValue([{ type: 'BVN' }]);
    prisma.kycVerification.create.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.verifyWithYouverify('user-1', {
      country: 'NG',
      type: 'BVN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      consentAccepted: true,
    });

    expect(kycProviderGateway.verifyIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        country: 'NG',
        type: 'BVN',
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
        type: 'BVN',
        documentUrl: null,
        idNumber: expect.stringMatching(/^enc:v1:/),
        status: 'PENDING',
      }),
    });
    expect(prisma.kycVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'YOUVERIFY',
        status: 'PENDING',
        reference: expect.stringMatching(/^pending:/),
        consentRecordedAt: expect.any(Date),
        consentVersion: 'youverify-subject-consent-v1',
        consentSource: 'WEB_OR_MOBILE',
      }),
    });
    expect(prisma.kycVerification.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: expect.objectContaining({
        status: 'VERIFIED',
        reference: 'youverify-verification-1',
        responseHash: 'youverify-response-hash',
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
        reference: 'youverify-verification-1',
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'YOUVERIFY',
        verificationStatus: 'VERIFIED',
        reference: 'youverify-verification-1',
        idNumber: '*******8901',
        kycTier: 'TIER_1',
      }),
    );
  });

  it('reserves the configured provider and forwards date of birth without persisting it', async () => {
    kycProviderGateway.provider = 'NINJA';
    kycProviderGateway.verifyIdentity.mockResolvedValueOnce({
      provider: 'NINJA',
      status: 'VERIFIED',
      reference: 'ninja-verification-1',
      checks: {
        country: 'NG',
        documentType: 'NIN',
        providerStatus: 'found',
        identifierMasked: '*******8901',
      },
      responseHash: 'ninja-response-hash',
    });
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

    await service.verifyWithYouverify('user-1', {
      country: 'NG',
      type: 'NIN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      consentAccepted: true,
    } as any);

    expect(prisma.kycVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'NINJA' }),
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

  it('releases a reserved KYC attempt when Youverify is unavailable', async () => {
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
      service.verifyWithYouverify('user-1', {
        country: 'NG',
        type: 'BVN',
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
  });

  it('returns a conflict when an active attempt already exists for the identity type', async () => {
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Okafor',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
    });
    prisma.kycDocument.create.mockRejectedValue(
      Object.assign(new Error('duplicate active attempt'), { code: 'P2002' }),
    );

    await expect(
      service.verifyWithYouverify('user-1', {
        country: 'NG',
        type: 'BVN',
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
      service.verifyWithYouverify('user-1', {
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
    kycProviderGateway.provider = 'NINJA';

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

  it('requires both legal names before reserving a Ninja attempt', async () => {
    kycProviderGateway.provider = 'NINJA';
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

  it('durably accepts a signed Youverify webhook without applying it inline', async () => {
    youverifyProvider.verifyCallbackSignature.mockReturnValue(true);
    youverifyProvider.normalizeCallback.mockReturnValue({
      provider: 'YOUVERIFY',
      status: 'VERIFIED',
      reference: 'youverify-verification-1',
      checks: {
        providerStatus: 'found',
        allValidationPassed: true,
      },
      responseHash: 'youverify-callback-hash',
    });
    kycWebhookInbox.accept.mockResolvedValue({
      eventId: 'kyc-webhook-event-1',
      duplicate: true,
    });

    const result = await service.processYouverifyCallback({
      body: {
        event: 'identity.completed',
        apiVersion: 'v2',
        data: { id: 'youverify-verification-1', status: 'found' },
      },
      rawBody:
        '{"event":"identity.completed","apiVersion":"v2","data":{"id":"youverify-verification-1","status":"found"}}',
      signatureHeader: 'signed-payload',
    });

    expect(youverifyProvider.verifyCallbackSignature).toHaveBeenCalledWith({
      rawBody: expect.any(String),
      signature: 'signed-payload',
    });
    expect(result).toEqual({
      received: true,
      duplicate: true,
      eventId: 'kyc-webhook-event-1',
    });
    expect(kycWebhookInbox.accept).toHaveBeenCalledWith({
      eventType: 'identity.completed',
      result: expect.objectContaining({
        reference: 'youverify-verification-1',
      }),
    });
    expect(prisma.kycVerification.findUnique).not.toHaveBeenCalled();
    expect(prisma.kycVerification.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('allows a verified callback to recover a prior transient failed result', async () => {
    prisma.kycVerification.findUnique.mockResolvedValue({
      id: 'verification-1',
      userId: 'user-1',
      documentId: 'kyc-1',
      provider: 'YOUVERIFY',
      status: 'FAILED',
      reference: 'youverify-verification-1',
      responseHash: 'failed-response-hash',
      document: {
        id: 'kyc-1',
        type: 'NIN',
        user: {
          kycStatus: 'SUBMITTED',
          kycTier: 'TIER_1',
        },
      },
    });
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.kycDocument.update.mockResolvedValue({ status: 'VERIFIED' });
    prisma.kycDocument.findMany.mockResolvedValue([
      { type: 'BVN' },
      { type: 'NIN' },
    ]);
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.applyYouverifyCallback({
      provider: 'YOUVERIFY',
      status: 'VERIFIED',
      reference: 'youverify-verification-1',
      checks: { providerStatus: 'found', allValidationPassed: true },
      responseHash: 'verified-response-hash',
      documentType: 'NIN',
      country: 'NG',
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'VERIFIED', kycTier: 'TIER_2' }),
    );
    expect(prisma.kycVerification.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'verification-1',
        status: { notIn: ['VERIFIED', 'REJECTED'] },
      },
      data: expect.objectContaining({ status: 'VERIFIED' }),
    });
  });

  it('does not overwrite a terminal result won by a concurrent callback', async () => {
    prisma.kycVerification.findUnique
      .mockResolvedValueOnce({
        id: 'verification-1',
        userId: 'user-1',
        documentId: 'kyc-1',
        provider: 'YOUVERIFY',
        status: 'FAILED',
        reference: 'youverify-verification-1',
        responseHash: 'failed-response-hash',
        document: {
          id: 'kyc-1',
          type: 'NIN',
          user: { kycStatus: 'SUBMITTED', kycTier: 'TIER_1' },
        },
      })
      .mockResolvedValueOnce({ status: 'VERIFIED' });
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.applyYouverifyCallback({
      provider: 'YOUVERIFY',
      status: 'REJECTED',
      reference: 'youverify-verification-1',
      checks: { providerStatus: 'rejected' },
      responseHash: 'rejected-response-hash',
      documentType: 'NIN',
      country: 'NG',
    });

    expect(result).toEqual({
      duplicate: false,
      ignored: true,
      status: 'VERIFIED',
    });
    expect(prisma.kycDocument.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
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
            provider: 'YOUVERIFY',
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
          provider: 'YOUVERIFY',
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
