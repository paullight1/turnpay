import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { createHmac } from 'crypto';
import { YouverifyProvider } from './youverify.provider';

describe('YouverifyProvider', () => {
  const httpService = {
    post: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'YOUVERIFY_API_KEY') return 'test-api-key';
      if (key === 'YOUVERIFY_BASE_URL') {
        return 'https://api.sandbox.youverify.co';
      }
      if (key === 'YOUVERIFY_WEBHOOK_SECRET') return 'test-webhook-secret';
      return undefined;
    }),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };
  const circuitBreaker = {
    canExecute: jest.fn().mockResolvedValue(true),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };

  let provider: YouverifyProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreaker.canExecute.mockResolvedValue(true);
    provider = new YouverifyProvider(
      httpService as any,
      configService as any,
      logger as any,
      circuitBreaker as any,
    );
  });

  it('verifies an NG BVN through the documented endpoint without logging the identifier', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          success: true,
          statusCode: 200,
          message: 'success',
          data: {
            id: 'provider-verification-1',
            status: 'found',
            dataValidation: true,
            allValidationPassed: true,
          },
        },
      }),
    );

    const result = await provider.verifyIdentity({
      userId: 'user-1',
      documentId: 'document-1',
      country: 'NG',
      type: 'BVN',
      identifier: '12345678901',
      identifierMasked: '*******8901',
      consentAccepted: true,
      validation: { firstName: 'Ada', lastName: 'Okafor' },
    });

    expect(httpService.post).toHaveBeenCalledWith(
      'https://api.sandbox.youverify.co/v2/api/identity/ng/bvn',
      {
        id: '12345678901',
        isSubjectConsent: true,
        validations: {
          data: { firstName: 'Ada', lastName: 'Okafor' },
        },
        metadata: { requestId: 'document-1' },
      },
      {
        headers: {
          token: 'test-api-key',
          'Content-Type': 'application/json',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'YOUVERIFY',
        status: 'VERIFIED',
        reference: 'provider-verification-1',
        checks: expect.objectContaining({
          identifierMasked: '*******8901',
          providerStatus: 'found',
        }),
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('12345678901');
    expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith('youverify');
  });

  it.each([
    ['pending', undefined, 'PENDING'],
    ['found', false, 'REVIEW_REQUIRED'],
    ['not_found', false, 'REJECTED'],
    ['failed', false, 'FAILED'],
  ] as const)(
    'normalizes provider status %s safely',
    async (providerStatus, allValidationPassed, expectedStatus) => {
      httpService.post.mockReturnValue(
        of({
          data: {
            success: true,
            statusCode: 200,
            message: 'processed',
            data: {
              id: 'provider-verification-2',
              status: providerStatus,
              allValidationPassed,
            },
          },
        }),
      );

      const result = await provider.verifyIdentity({
        userId: 'user-1',
        documentId: 'document-2',
        country: 'NG',
        type: 'NIN',
        identifier: '12345678901',
        identifierMasked: '*******8901',
        consentAccepted: true,
      });

      expect(result.status).toBe(expectedStatus);
    },
  );

  it('requires every requested validation to pass before verifying a found identity', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          success: true,
          statusCode: 200,
          message: 'processed',
          data: {
            id: 'provider-name-mismatch',
            status: 'found',
            dataValidation: true,
            allValidationPassed: false,
          },
        },
      }),
    );

    const result = await provider.verifyIdentity({
      userId: 'user-1',
      documentId: 'document-mismatch',
      country: 'NG',
      type: 'NIN',
      identifier: '12345678901',
      identifierMasked: '*******8901',
      consentAccepted: true,
      validation: { firstName: 'Ada', lastName: 'Okafor' },
    });

    expect(result.status).toBe('REVIEW_REQUIRED');
  });

  it('maps Ghana voter cards to the documented Ghana voter endpoint', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          success: true,
          statusCode: 200,
          message: 'success',
          data: {
            id: 'provider-verification-gh',
            status: 'found',
            allValidationPassed: true,
          },
        },
      }),
    );

    await provider.verifyIdentity({
      userId: 'user-1',
      documentId: 'document-gh',
      country: 'GH',
      type: 'VOTERS_CARD',
      identifier: '1234567890',
      identifierMasked: '******7890',
      consentAccepted: true,
    });

    expect(httpService.post).toHaveBeenCalledWith(
      'https://api.sandbox.youverify.co/v2/api/identity/gh/voter',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('rejects unsupported country and document combinations before calling Youverify', async () => {
    await expect(
      provider.verifyIdentity({
        userId: 'user-1',
        documentId: 'document-unsupported',
        country: 'GH',
        type: 'BVN',
        identifier: '12345678901',
        identifierMasked: '*******8901',
        consentAccepted: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('verifies the raw webhook body using the Youverify HMAC-SHA256 contract', () => {
    const rawBody = JSON.stringify({
      event: 'identity.completed',
      data: { id: 'provider-verification-1', status: 'found' },
    });
    const signature = createHmac('sha256', 'test-webhook-secret')
      .update(rawBody)
      .digest('hex');

    expect(provider.verifyCallbackSignature({ rawBody, signature })).toBe(true);
    expect(
      provider.verifyCallbackSignature({
        rawBody: `${rawBody} `,
        signature,
      }),
    ).toBe(false);
  });

  it('normalizes webhook results without retaining raw identity fields', () => {
    const result = provider.normalizeCallback({
      event: 'identity.completed',
      apiVersion: 'v2',
      data: {
        id: 'provider-verification-1',
        status: 'found',
        allValidationPassed: true,
        dataValidation: true,
        type: 'nin',
        country: 'NG',
        idNumber: '12345678901',
        image: 'data:image/jpeg;base64,sensitive',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'YOUVERIFY',
        status: 'VERIFIED',
        reference: 'provider-verification-1',
        documentType: 'NIN',
        country: 'NG',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('12345678901');
    expect(JSON.stringify(result)).not.toContain('base64');
  });

  it('produces the same callback hash for identical webhook replays', () => {
    const payload = {
      event: 'identity.completed',
      apiVersion: 'v2',
      data: {
        id: 'provider-verification-replay',
        status: 'found',
        allValidationPassed: false,
        dataValidation: true,
        type: 'nin',
        country: 'NG',
      },
    };

    const first = provider.normalizeCallback(payload);
    const second = provider.normalizeCallback(payload);

    expect(second.responseHash).toBe(first.responseHash);
    expect(first.checks).not.toHaveProperty('receivedAt');
  });
});
