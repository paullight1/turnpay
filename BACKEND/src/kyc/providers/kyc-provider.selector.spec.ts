import { selectKycProvider } from './kyc-provider.selector';

describe('selectKycProvider', () => {
  const ninja = { provider: 'NINJA' };
  const youverify = { provider: 'YOUVERIFY' };

  it('selects Ninja explicitly', () => {
    expect(selectKycProvider('ninja', ninja as any, youverify as any)).toBe(
      ninja,
    );
  });

  it('keeps Youverify available for an explicit rollback', () => {
    expect(selectKycProvider('youverify', ninja as any, youverify as any)).toBe(
      youverify,
    );
  });

  it('does not silently fall back for an unknown provider', () => {
    expect(() =>
      selectKycProvider('manual', ninja as any, youverify as any),
    ).toThrow('Unsupported KYC provider');
  });
});
