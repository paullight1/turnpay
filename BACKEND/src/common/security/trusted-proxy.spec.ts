import { forwardedChainLength, isForwardedChainAllowed } from './trusted-proxy';

describe('trusted proxy forwarding policy', () => {
  it('counts a normalized forwarded-for chain', () => {
    expect(forwardedChainLength('203.0.113.4, 10.0.0.2')).toBe(2);
    expect(forwardedChainLength(undefined)).toBe(0);
  });

  it('rejects caller-supplied addresses beyond the configured proxy hops', () => {
    expect(isForwardedChainAllowed('203.0.113.4', 1)).toBe(true);
    expect(isForwardedChainAllowed('203.0.113.4, 10.0.0.2', 1)).toBe(false);
  });

  it('rejects forwarded headers when direct local mode trusts no proxy', () => {
    expect(isForwardedChainAllowed('203.0.113.4', 0)).toBe(false);
    expect(isForwardedChainAllowed(undefined, 0)).toBe(true);
  });

  it('accepts Render-managed forwarded chains regardless of internal hop count', () => {
    expect(
      isForwardedChainAllowed('203.0.113.4, 172.16.0.10, 10.0.0.2', 2, true),
    ).toBe(true);
  });

  it('still rejects excessive forwarded chains outside Render', () => {
    expect(
      isForwardedChainAllowed('203.0.113.4, 172.16.0.10, 10.0.0.2', 2, false),
    ).toBe(false);
  });
});
