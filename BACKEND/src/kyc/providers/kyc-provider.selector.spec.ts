import { selectKycProvider } from './kyc-provider.selector';

describe('selectKycProvider', () => {
  const monnify = { provider: 'MONNIFY' };
  const paystack = { provider: 'PAYSTACK' };

  it('selects Monnify explicitly', () => {
    expect(selectKycProvider('monnify', monnify as any)).toBe(monnify);
  });

  it('does not silently fall back for an unknown provider', () => {
    expect(() => selectKycProvider('manual', monnify as any)).toThrow(
      'KYC_PROVIDER must be monnify or paystack',
    );
  });

  it('selects Paystack when configured', () => {
    expect(selectKycProvider('paystack', monnify as any, paystack as any)).toBe(
      paystack,
    );
  });
});
