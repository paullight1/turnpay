import { BadRequestException } from '@nestjs/common';
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
    get: jest.fn((key: string) =>
      key === 'PII_ENCRYPTION_KEY'
        ? 'test-pii-key-with-enough-entropy'
        : undefined,
    ),
  };

  const logger = {
    info: jest.fn(),
  };

  const supabase = {
    createSignedUploadUrl: jest.fn(),
    createSignedReadUrl: jest.fn(),
  };

  const kycProviderGateway = {
    submitVerification: jest.fn(),
    createHostedSession: jest.fn(),
    verifyCallbackSignature: jest.fn(),
    normalizeCallback: jest.fn(),
  };

  let service: KycService;

  beforeEach(() => {
    jest.clearAllMocks();
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
    kycProviderGateway.submitVerification.mockResolvedValue({
      provider: 'MANUAL_REVIEW',
      status: 'REVIEW_REQUIRED',
      reference: 'manual-kyc-1',
      checks: {
        documentType: 'BVN',
        identifierMasked: '*******8901',
        manualReviewRequired: true,
      },
      responseHash: 'response-hash',
    });
    kycProviderGateway.createHostedSession.mockResolvedValue({
      provider: 'SMILE_ID',
      status: 'PENDING',
      reference: 'kyc-session-1',
      checks: {
        country: 'NG',
        documentType: 'BVN',
        hostedCapture: true,
      },
      responseHash: 'smile-session-hash',
      product: 'biometric_kyc',
      environment: 'sandbox',
      token: 'smile-web-token',
      expiresInSeconds: 900,
    });
    kycProviderGateway.verifyCallbackSignature.mockReturnValue(true);
    kycProviderGateway.normalizeCallback.mockReturnValue({
      provider: 'SMILE_ID',
      status: 'VERIFIED',
      reference: 'kyc-session-1',
      checks: {
        resultCode: '1020',
        resultText: 'Exact Match',
      },
      responseHash: 'smile-callback-hash',
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
      kycProviderGateway,
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

  it('encrypts submitted BVN values and returns only a masked identifier', async () => {
    prisma.kycDocument.findFirst.mockResolvedValue(null);
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: 'kyc-1',
      ...data,
      createdAt: new Date('2026-05-21T00:00:00.000Z'),
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
    }));
    prisma.user.update.mockResolvedValue({});

    const result = await service.submitKyc('user-1', {
      type: 'BVN',
      idNumber: '12345678901',
      documentObjectKey: 'kyc/user-1/kyc-1.pdf',
    });

    const createdArgs = prisma.kycDocument.create.mock.calls[0][0];
    expect(createdArgs.data.idNumber).toMatch(/^enc:v1:/);
    expect(createdArgs.data.idNumber).not.toContain('12345678901');
    expect(kycProviderGateway.submitVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'BVN',
        identifierMasked: '*******8901',
      }),
    );
    expect(prisma.kycVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        documentId: expect.any(String),
        provider: 'MANUAL_REVIEW',
        status: 'REVIEW_REQUIRED',
        checks: expect.objectContaining({
          identifierMasked: '*******8901',
        }),
        responseHash: 'response-hash',
      }),
    });
    expect(result.idNumber).toBe('*******8901');
    expect(result).not.toHaveProperty('documentUrl');
  });

  it('rejects incorrectly shaped BVN submissions', async () => {
    await expect(
      service.submitKyc('user-1', {
        type: 'BVN',
        idNumber: '12345',
        documentObjectKey: 'kyc/user-1/kyc-1.pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.kycDocument.create).not.toHaveBeenCalled();
  });

  it('rejects document object keys outside the current user scope', async () => {
    await expect(
      service.submitKyc('user-1', {
        type: 'NIN',
        idNumber: '12345678901',
        documentObjectKey: 'kyc/user-2/kyc-1.pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates Smile ID hosted sessions without storing local ID numbers', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'PII_ENCRYPTION_KEY') {
        return 'test-pii-key-with-enough-entropy';
      }
      if (key === 'SMILE_ID_CALLBACK_URL') {
        return 'https://api.example.com/api/webhooks/kyc/smile-id';
      }
      return undefined;
    });
    prisma.kycDocument.findFirst.mockResolvedValue(null);
    prisma.kycDocument.create.mockImplementation(async ({ data }) => ({
      id: 'kyc-1',
      ...data,
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    }));
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.createSmileIdSession('user-1', {
      country: 'NG',
      type: 'BVN',
      consentAccepted: true,
    });

    expect(kycProviderGateway.createHostedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'BVN',
        country: 'NG',
        callbackUrl: 'https://api.example.com/api/webhooks/kyc/smile-id',
      }),
    );
    expect(prisma.kycDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'BVN',
        documentUrl: null,
        idNumber: null,
        status: 'SUBMITTED',
      }),
    });
    expect(result.token).toBe('smile-web-token');
    expect(result.document.idNumber).toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'KYC_SMILE_SESSION_CREATED',
        reference: 'kyc-session-1',
      }),
    });
  });

  it('processes signed Smile ID callbacks and promotes Ghana Card to tier 2', async () => {
    const callbackTime = new Date().toISOString();
    prisma.kycVerification.findUnique.mockResolvedValue({
      id: 'verification-1',
      userId: 'user-1',
      documentId: 'kyc-1',
      provider: 'SMILE_ID',
      status: 'PENDING',
      reference: 'kyc-session-1',
      responseHash: 'old-hash',
      document: {
        id: 'kyc-1',
        type: 'GHANA_CARD',
        user: {
          kycStatus: 'SUBMITTED',
          kycTier: 'TIER_0',
        },
      },
    });
    prisma.kycVerification.update.mockResolvedValue({});
    prisma.kycDocument.findMany.mockResolvedValue([{ type: 'GHANA_CARD' }]);
    prisma.kycDocument.update.mockResolvedValue({
      id: 'kyc-1',
      status: 'VERIFIED',
    });
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.processSmileIdCallback({
      body: {
        signature: 'signature',
        timestamp: callbackTime,
        result: {
          PartnerParams: {
            user_id: 'user-1',
            job_id: 'kyc-session-1',
          },
          ResultCode: '1020',
          ResultText: 'Exact Match',
        },
      },
    });

    expect(kycProviderGateway.verifyCallbackSignature).toHaveBeenCalledWith({
      signature: 'signature',
      timestamp: callbackTime,
    });
    expect(prisma.kycVerification.update).toHaveBeenCalledWith({
      where: { id: 'verification-1' },
      data: expect.objectContaining({
        status: 'VERIFIED',
        responseHash: 'smile-callback-hash',
      }),
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { kycStatus: 'VERIFIED', kycTier: 'TIER_2' },
    });
    expect(result).toEqual(
      expect.objectContaining({
        received: true,
        duplicate: false,
        status: 'VERIFIED',
        kycStatus: 'VERIFIED',
        kycTier: 'TIER_2',
      }),
    );
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
