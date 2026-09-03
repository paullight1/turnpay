import { UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUserThrottlerGuard } from './authenticated-user-throttler.guard';

describe('AuthenticatedUserThrottlerGuard', () => {
  const guard = Object.create(
    AuthenticatedUserThrottlerGuard.prototype,
  ) as AuthenticatedUserThrottlerGuard;
  const getTracker = (request: Record<string, unknown>) =>
    (
      guard as unknown as {
        getTracker: (req: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker(request);

  it('uses only the identity populated by the JWT guard', async () => {
    await expect(
      getTracker({
        ip: '203.0.113.10',
        user: { userId: 'user-1' },
      }),
    ).resolves.toBe('user:user-1');
  });

  it('fails closed when no verified user is present', async () => {
    await expect(
      getTracker({
        ip: '203.0.113.10',
        headers: { authorization: 'Bearer forged.jwt' },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('gives users behind one IP independent buckets', async () => {
    const first = await getTracker({
      ip: '203.0.113.10',
      user: { userId: 'user-1' },
    });
    const second = await getTracker({
      ip: '203.0.113.10',
      user: { userId: 'user-2' },
    });

    expect(first).not.toBe(second);
  });
});
