import { of } from 'rxjs';
import { MonnifyProvider } from './monnify.provider';

describe('MonnifyProvider', () => {
  const httpService = { post: jest.fn() };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | boolean> = {
        MONNIFY_API_KEY: 'api-key',
        MONNIFY_SECRET_KEY: 'secret-key',
        MONNIFY_BASE_URL: 'https://sandbox.monnify.com',
        BANKING_SANDBOX_MODE: true,
      };
      return values[key];
    }),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const circuitBreaker = {
    canExecute: jest.fn().mockResolvedValue(true),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  };

  let provider: MonnifyProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreaker.canExecute.mockResolvedValue(true);
    provider = new MonnifyProvider(
      httpService as any,
      config as any,
      logger as any,
      circuitBreaker as any,
    );
  });

  it('verifies NIN through Monnify and returns a normalized match', async () => {
    httpService.post
      .mockReturnValueOnce(
        of({
          data: {
            requestSuccessful: true,
            responseBody: { accessToken: 'token' },
          },
        }),
      )
      .mockReturnValueOnce(
        of({
          data: {
            requestSuccessful: true,
            responseCode: '0',
            responseBody: { ninInformationMatch: true },
          },
        }),
      );

    const result = await provider.verifyIdentity({
      userId: 'user-1',
      documentId: 'document-1',
      type: 'NIN',
      identifierMasked: '*******8901',
      country: 'NG',
      identifier: '12345678901',
      consentAccepted: true,
    });

    expect(httpService.post).toHaveBeenNthCalledWith(
      2,
      'https://sandbox.monnify.com/api/v1/vas/nin-verification',
      { nin: '12345678901' },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'MONNIFY',
        status: 'VERIFIED',
        reference: 'monnify:nin:document-1',
      }),
    );
  });

  it('sends the required BVN matching fields to Monnify', async () => {
    httpService.post
      .mockReturnValueOnce(
        of({
          data: {
            requestSuccessful: true,
            responseBody: { accessToken: 'token' },
          },
        }),
      )
      .mockReturnValueOnce(
        of({
          data: {
            requestSuccessful: true,
            responseBody: { bvnInformationMatch: true },
          },
        }),
      );

    await provider.verifyIdentity({
      userId: 'user-1',
      documentId: 'document-2',
      type: 'BVN',
      identifierMasked: '*******8901',
      country: 'NG',
      identifier: '12345678901',
      consentAccepted: true,
      validation: {
        firstName: 'Ada',
        lastName: 'Okafor',
        dateOfBirth: '1990-01-02',
        phone: '+2348012345678',
      },
    });

    expect(httpService.post).toHaveBeenNthCalledWith(
      2,
      'https://sandbox.monnify.com/api/v1/vas/bvn-details-match',
      {
        bvn: '12345678901',
        name: 'Ada Okafor',
        dateOfBirth: '02-Jan-1990',
        mobileNo: '08012345678',
      },
      expect.anything(),
    );
  });
});
