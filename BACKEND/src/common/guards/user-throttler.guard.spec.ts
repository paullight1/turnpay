import { UserThrottlerGuard } from './user-throttler.guard';

describe('UserThrottlerGuard', () => {
  const guard = Object.create(
    UserThrottlerGuard.prototype,
  ) as UserThrottlerGuard;
  const getTracker = (request: Record<string, unknown>) =>
    (
      guard as unknown as {
        getTracker: (req: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker(request);

  it('does not trust a bearer token before authentication has verified it', async () => {
    await expect(
      getTracker({
        ip: '203.0.113.10',
        headers: { authorization: 'Bearer forged.jwt.with-sub' },
      }),
    ).resolves.toBe('ip:203.0.113.10');
  });

  it('keeps the broad abuse bucket IP-based after authentication', async () => {
    await expect(
      getTracker({
        ip: '203.0.113.10',
        user: { userId: 'user-1' },
      }),
    ).resolves.toBe('ip:203.0.113.10');
  });

  it('uses the normalized proxy address for unauthenticated requests', async () => {
    await expect(
      getTracker({
        ip: '10.0.0.1',
        ips: ['198.51.100.25', '10.0.0.1'],
      }),
    ).resolves.toBe('ip:198.51.100.25');
  });
});
