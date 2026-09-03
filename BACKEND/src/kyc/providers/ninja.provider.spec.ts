import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { NinjaProvider } from './ninja.provider';

describe('NinjaProvider', () => {
  const httpService = { post: jest.fn() };
  const configValues: Record<string, string> = {
    NINJA_CLIENT_KEY: 'test-client-key',
    NINJA_CLIENT_SECRET: 'test-client-secret',
    NINJA_BASE_URL: 'https://api.sandbox.ninja.boucloud.io',
  };
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const circuitBreaker = {
    canExecute: jest.fn().mockResolvedValue(true),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };

  const acceptedResponse = {
    data: {
      id: '77777777777',
      found: true,
      verified: true,
      score: 1,
      recommendation: 'accept',
      fields: [
        {
          field: 'first_name',
          score: 1,
          match: 'exact',
          provided: 'James',
          detail: 'sensitive provider detail',
        },
      ],
      image: 'data:image/jpeg;base64,sensitive',
      mobile: '+2348000000000',
    },
  };

  const request = {
    userId: 'user-1',
    documentId: 'document-1',
    country: 'NG' as const,
    type: 'NIN' as const,
    identifier: '77777777777',
    identifierMasked: '*******7777',
    consentAccepted: true as const,
    validation: {
      firstName: 'James',
      lastName: 'Bond',
      dateOfBirth: '1975-01-01',
    },
  };

  let provider: NinjaProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreaker.canExecute.mockResolvedValue(true);
    configService.get.mockImplementation((key: string) => configValues[key]);
    httpService.post.mockImplementation((url: string) => {
      if (url.endsWith('/auth/session')) {
        return of({
          data: {
            token: 'session-token',
            expiry: new Date(Date.now() + 5 * 60_000).toISOString(),
          },
        });
      }
      return of(acceptedResponse);
    });
    provider = new NinjaProvider(
      httpService as any,
      configService as any,
      logger as any,
      circuitBreaker as any,
    );
  });

  it('verifies an NIN using server-side authentication and Ninja verify mode', async () => {
    const result = await provider.verifyIdentity(request);

    expect(httpService.post).toHaveBeenNthCalledWith(
      1,
      'https://api.sandbox.ninja.boucloud.io/auth/session',
      {
        client_key: 'test-client-key',
        client_secret: 'test-client-secret',
      },
      { headers: { 'Content-Type': 'application/json' } },
    );
    expect(httpService.post).toHaveBeenNthCalledWith(
      2,
      'https://api.sandbox.ninja.boucloud.io/api/identity/identify',
      {
        idType: 'nin',
        mode: 'verify',
        idNumber: '77777777777',
        firstName: 'James',
        lastName: 'Bond',
        dateOfBirth: '1975-01-01',
        reference: 'document-1',
      },
      {
        headers: {
          Authorization: 'Bearer session-token',
          'Content-Type': 'application/json',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'NINJA',
        status: 'VERIFIED',
        reference: 'document-1',
        checks: expect.objectContaining({
          providerStatus: 'found',
          found: true,
          verified: true,
          recommendation: 'accept',
          identifierMasked: '*******7777',
          fields: [{ field: 'first_name', score: 1, match: 'exact' }],
        }),
      }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('1975-01-01');
    expect(serialized).not.toContain('James');
    expect(serialized).not.toContain('+2348000000000');
    expect(serialized).not.toContain('base64');
    expect(serialized).not.toContain('sensitive provider detail');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('77777777777');
    expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith('ninja');
  });

  it('supports BVN but rejects unsupported countries and document types', async () => {
    await provider.verifyIdentity({ ...request, type: 'BVN' });
    expect(httpService.post).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/identity/identify'),
      expect.objectContaining({ idType: 'bvn' }),
      expect.any(Object),
    );

    await expect(
      provider.verifyIdentity({ ...request, country: 'GH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      provider.verifyIdentity({ ...request, type: 'DRIVERS_LICENSE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires consent and complete match inputs before any upstream call', async () => {
    await expect(
      provider.verifyIdentity({ ...request, consentAccepted: false as true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      provider.verifyIdentity({
        ...request,
        validation: { firstName: 'James' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('reuses one cached token and coalesces concurrent authentication', async () => {
    await Promise.all([
      provider.verifyIdentity(request),
      provider.verifyIdentity({ ...request, documentId: 'document-2' }),
    ]);

    const authCalls = httpService.post.mock.calls.filter(([url]) =>
      String(url).endsWith('/auth/session'),
    );
    expect(authCalls).toHaveLength(1);
  });

  it('refreshes authentication once after a 401 and preserves the reference', async () => {
    let authAttempt = 0;
    let identityAttempt = 0;
    httpService.post.mockImplementation((url: string, body: unknown) => {
      if (url.endsWith('/auth/session')) {
        authAttempt += 1;
        return of({
          data: {
            token: `session-token-${authAttempt}`,
            expiry: new Date(Date.now() + 5 * 60_000).toISOString(),
          },
        });
      }
      identityAttempt += 1;
      if (identityAttempt === 1) {
        return throwError(() => ({
          isAxiosError: true,
          response: { status: 401 },
        }));
      }
      expect(body).toEqual(
        expect.objectContaining({ reference: 'document-1' }),
      );
      return of(acceptedResponse);
    });

    await expect(provider.verifyIdentity(request)).resolves.toEqual(
      expect.objectContaining({ status: 'VERIFIED' }),
    );
    expect(authAttempt).toBe(2);
    expect(identityAttempt).toBe(2);
  });

  it.each([
    [
      { found: true, verified: false, score: 0.8, recommendation: 'review' },
      'REVIEW_REQUIRED',
    ],
    [
      { found: true, verified: false, score: 0.4, recommendation: 'reject' },
      'REJECTED',
    ],
    [{ found: false, verified: false }, 'REJECTED'],
  ] as const)('maps a non-accept result to %s safely', async (data, status) => {
    httpService.post.mockImplementation((url: string) =>
      url.endsWith('/auth/session')
        ? of({
            data: {
              token: 'session-token',
              expiry: new Date(Date.now() + 5 * 60_000).toISOString(),
            },
          })
        : of({ data }),
    );

    await expect(provider.verifyIdentity(request)).resolves.toEqual(
      expect.objectContaining({ status }),
    );
  });

  it('fails closed on contradictory or malformed success responses', async () => {
    httpService.post.mockImplementation((url: string) =>
      url.endsWith('/auth/session')
        ? of({
            data: {
              token: 'session-token',
              expiry: new Date(Date.now() + 5 * 60_000).toISOString(),
            },
          })
        : of({
            data: {
              found: true,
              verified: true,
              recommendation: 'review',
            },
          }),
    );

    await expect(provider.verifyIdentity(request)).resolves.toEqual(
      expect.objectContaining({ status: 'REVIEW_REQUIRED' }),
    );
  });

  it.each([402, 429, 500])(
    'returns a safe unavailable error for upstream status %s',
    async (status) => {
      httpService.post.mockImplementation((url: string) =>
        url.endsWith('/auth/session')
          ? of({
              data: {
                token: 'session-token',
                expiry: new Date(Date.now() + 5 * 60_000).toISOString(),
              },
            })
          : throwError(() => ({
              isAxiosError: true,
              response: {
                status,
                data: { message: 'provider secret diagnostic' },
              },
            })),
      );

      await expect(provider.verifyIdentity(request)).rejects.toThrow(
        'Identity verification could not be completed',
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
        'provider secret diagnostic',
      );
      expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('ninja');
    },
  );

  it('rejects a non-Ninja base URL before sending credentials', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'NINJA_BASE_URL' ? 'https://attacker.example' : configValues[key],
    );

    await expect(provider.verifyIdentity(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(httpService.post).not.toHaveBeenCalled();
  });
});
