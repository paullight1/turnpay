import { KycVerificationStatus } from '@prisma/client';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaystackProvider } from './paystack.provider';
import { KycProviderDefinitiveFailure } from './kyc-provider.gateway';

describe('PaystackProvider', () => {
  const client = { ensureCustomer: jest.fn(), request: jest.fn() };
  const prisma = {
    paystackCustomer: { findUnique: jest.fn(), update: jest.fn() },
    kycVerification: { findFirst: jest.fn(), updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    prisma.kycVerification.findFirst.mockResolvedValue({
      checks: { paystackRecovery: { leaseId: 'early-recovery-lease' } },
    });
    client.ensureCustomer.mockResolvedValue({
      customerCode: 'CUS_fixture123',
      customerId: '123',
    });
    client.request.mockResolvedValue({});
    prisma.paystackCustomer.update.mockResolvedValue({});
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      validationFingerprint: null,
    });
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 1 });
  });

  it('submits BVN bank-account identification and keeps the result pending', async () => {
    const provider = new PaystackProvider(client as any, prisma as any);

    const result = await provider.verifyIdentity({
      userId: 'user-1',
      documentId: 'document-1',
      type: 'BVN',
      identifier: '12345678901',
      identifierMasked: '*******8901',
      country: 'NG',
      consentAccepted: true,
      validation: {
        firstName: 'Ada',
        lastName: 'Okafor',
        bankCode: '058',
        accountNumber: '0123456789',
        accountSetupConsent: true,
      },
    });

    expect(client.request).toHaveBeenCalledWith(
      'POST',
      '/customer/CUS_fixture123/identification',
      expect.objectContaining({
        country: 'NG',
        type: 'bank_account',
        bvn: '12345678901',
        account_number: '0123456789',
        bank_code: '058',
        first_name: 'Ada',
        last_name: 'Okafor',
      }),
    );
    expect(prisma.paystackCustomer.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({
        validationFingerprint: expect.any(String),
        accountSetupConsentAt: expect.any(Date),
      }),
    });
    expect(prisma.kycVerification.updateMany).toHaveBeenCalledWith({
      where: { documentId: 'document-1', status: 'PENDING' },
      data: {
        checks: expect.objectContaining({
          customerCode: 'CUS_fixture123',
          paystackRecovery: { leaseId: 'early-recovery-lease' },
          validationFingerprint: expect.any(String),
          accountSetupConsent: true,
        }),
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'PAYSTACK',
        status: KycVerificationStatus.PENDING,
        reference: expect.stringContaining('CUS_fixture123'),
        checks: expect.objectContaining({
          customerCode: 'CUS_fixture123',
          accountSetupConsent: true,
          accountNumberMasked: '******6789',
        }),
      }),
    );
  });

  it('rejects BVN submission without bank details before calling Paystack', async () => {
    const provider = new PaystackProvider(client as any, prisma as any);

    await expect(
      provider.verifyIdentity({
        userId: 'user-1',
        documentId: 'document-1',
        type: 'BVN',
        identifier: '12345678901',
        identifierMasked: '*******8901',
        country: 'NG',
        consentAccepted: true,
        validation: { firstName: 'Ada', lastName: 'Okafor' },
      }),
    ).rejects.toThrow('Bank code and account number are required');
    expect(client.ensureCustomer).not.toHaveBeenCalled();
  });

  it('rejects changed identity details after a previous Paystack attempt', async () => {
    const provider = new PaystackProvider(client as any, prisma as any);
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      validationFingerprint: 'previous-attempt',
    });

    await expect(
      provider.verifyIdentity({
        userId: 'user-1',
        documentId: 'document-2',
        type: 'BVN',
        identifier: '12345678901',
        identifierMasked: '*******8901',
        country: 'NG',
        consentAccepted: true,
        validation: {
          firstName: 'Ada',
          lastName: 'Okafor',
          bankCode: '058',
          accountNumber: '0123456789',
        },
      }),
    ).rejects.toThrow('identity details cannot be changed');
    expect(client.request).not.toHaveBeenCalled();
  });

  it('rejects a new validation after the Paystack binding is verified', async () => {
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      validationFingerprint: 'previous-attempt',
      validationStatus: 'VERIFIED',
    });
    const provider = new PaystackProvider(client as any, prisma as any);

    await expect(
      provider.verifyIdentity({
        userId: 'user-1',
        documentId: 'document-2',
        type: 'BVN',
        identifier: '12345678901',
        identifierMasked: '*******8901',
        country: 'NG',
        consentAccepted: true,
        validation: {
          firstName: 'Ada',
          lastName: 'Okafor',
          bankCode: '058',
          accountNumber: '0123456789',
        },
      }),
    ).rejects.toThrow('identity verification is already complete');
    expect(prisma.kycVerification.updateMany).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
  });

  it('does not dispatch when the verification reservation is no longer pending', async () => {
    prisma.kycVerification.updateMany.mockResolvedValue({ count: 0 });
    const provider = new PaystackProvider(client as any, prisma as any);

    await expect(
      provider.verifyIdentity({
        userId: 'user-1',
        documentId: 'document-1',
        type: 'BVN',
        identifier: '12345678901',
        identifierMasked: '*******8901',
        country: 'NG',
        consentAccepted: true,
        validation: {
          firstName: 'Ada',
          lastName: 'Okafor',
          bankCode: '058',
          accountNumber: '0123456789',
        },
      }),
    ).rejects.toThrow('reservation is no longer pending');
    expect(client.request).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous Paystack dispatch pending after a timeout', async () => {
    client.request.mockRejectedValueOnce(
      new ServiceUnavailableException('Paystack confirmation is unavailable'),
    );
    const provider = new PaystackProvider(client as any, prisma as any);

    const result = await provider.verifyIdentity({
      userId: 'user-1',
      documentId: 'document-1',
      type: 'BVN',
      identifier: '12345678901',
      identifierMasked: '*******8901',
      country: 'NG',
      consentAccepted: true,
      validation: {
        firstName: 'Ada',
        lastName: 'Okafor',
        bankCode: '058',
        accountNumber: '0123456789',
      },
    });

    expect(result.status).toBe(KycVerificationStatus.PENDING);
    expect(result.checks).toEqual(
      expect.objectContaining({ providerStatus: 'confirmation_pending' }),
    );
  });

  it.each([400, 422])(
    'marks an upstream %s response as a definitive validation rejection',
    async (providerStatusCode) => {
      client.request.mockRejectedValueOnce(
        new BadRequestException('Paystack request failed', {
          cause: { providerStatusCode },
        }),
      );
      const provider = new PaystackProvider(client as any, prisma as any);

      const failure = await provider
        .verifyIdentity({
          userId: 'user-1',
          documentId: 'document-1',
          type: 'BVN',
          identifier: '12345678901',
          identifierMasked: '*******8901',
          country: 'NG',
          consentAccepted: true,
          validation: {
            firstName: 'Ada',
            lastName: 'Okafor',
            bankCode: '058',
            accountNumber: '0123456789',
          },
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(KycProviderDefinitiveFailure);
      expect(
        (failure as KycProviderDefinitiveFailure).validationFingerprint,
      ).toEqual(expect.any(String));
    },
  );

  it('preserves an ambiguous Paystack rejection without classifying it as validation failure', async () => {
    const error = new BadRequestException('Paystack request failed', {
      cause: { providerStatusCode: 429 },
    });
    client.request.mockRejectedValueOnce(error);
    const provider = new PaystackProvider(client as any, prisma as any);

    await expect(
      provider.verifyIdentity({
        userId: 'user-1',
        documentId: 'document-1',
        type: 'BVN',
        identifier: '12345678901',
        identifierMasked: '*******8901',
        country: 'NG',
        consentAccepted: true,
        validation: {
          firstName: 'Ada',
          lastName: 'Okafor',
          bankCode: '058',
          accountNumber: '0123456789',
        },
      }),
    ).rejects.toBe(error);
  });
});
