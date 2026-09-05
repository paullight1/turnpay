import { of } from 'rxjs';
import { MonnifyVirtualAccountProvider } from './monnify-virtual-account.provider';

describe('Monnify KYC update contract', () => {
  const http = { put: jest.fn() };
  const config = {
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
  };
  let provider: MonnifyVirtualAccountProvider;
  beforeEach(() => {
    http.put.mockReset();
    provider = new MonnifyVirtualAccountProvider(http as any, config as any);
    jest
      .spyOn(provider as any, 'getAccessToken')
      .mockResolvedValue('test-token');
  });
  it('uses the KYC-info PUT and accepts only a confirmed success', async () => {
    http.put.mockReturnValue(of({ data: { requestSuccessful: true } }));
    await provider.updateReservedAccountKyc('TP-NGN-user', {
      bvn: '12345678901',
      nin: '12345678902',
    });
    expect(http.put).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/bank-transfer/reserved-accounts/TP-NGN-user/kyc-info',
      ),
      { bvn: '12345678901', nin: '12345678902' },
      expect.any(Object),
    );
  });
  it('does not mark an unsuccessful response as synced', async () => {
    http.put.mockReturnValue(of({ data: { requestSuccessful: false } }));
    await expect(
      provider.updateReservedAccountKyc('TP-NGN-user', {
        bvn: '12345678901',
        nin: '12345678902',
      }),
    ).rejects.toThrow('Could not update');
  });
  it('rejects malformed identifiers before calling Monnify', async () => {
    await expect(
      provider.updateReservedAccountKyc('TP-NGN-user', {
        bvn: '123',
        nin: '12345678902',
      }),
    ).rejects.toThrow();
    expect(http.put).not.toHaveBeenCalled();
  });
});
