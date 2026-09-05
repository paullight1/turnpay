import { ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('admin authorization from verified identity', () => {
  const identity = {
    id: 'staff-id',
    email: 'support@trustpayhq.com',
    email_confirmed_at: '2026-09-05T00:00:00Z',
  };
  const account = {
    id: 'staff-id',
    email: identity.email,
    role: 'USER',
    isSuspended: false,
  };
  async function authorize(
    overrides: Record<string, unknown> = {},
    accountOverrides: Record<string, unknown> = {},
  ) {
    const current = { ...account, ...accountOverrides };
    const supabase = {
      verifyToken: jest.fn().mockResolvedValue({ ...identity, ...overrides }),
      syncUser: jest.fn().mockResolvedValue(current),
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(current) },
    };
    const request = {
      headers: { authorization: 'Bearer test-token' },
      user: undefined as unknown,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => null,
      getClass: () => null,
    };
    const guard = new JwtAuthGuard(
      supabase as never,
      prisma as never,
      {} as never,
    );
    await guard.canActivate(context as never);
    const roles = new RolesGuard({
      getAllAndOverride: () => ['ADMIN'],
    } as never);
    return { request, roles, context };
  }
  it('allows a confirmed exact-domain staff identity without changing its stored role', async () => {
    const { request, roles, context } = await authorize();
    expect(request.user).toEqual(
      expect.objectContaining({ role: 'USER', canAccessAdmin: true }),
    );
    expect(roles.canActivate(context as never)).toBe(true);
  });
  it.each([
    { email_confirmed_at: undefined },
    { email: 'support@trustpayhq.com.attacker.test' },
    { email: 'support@sub.trustpayhq.com' },
    {
      email: 'support@other.test',
      user_metadata: { role: 'ADMIN', email_verified: true },
    },
  ])(
    'rejects unverified, mismatched or lookalike identities: %j',
    async (overrides) => {
      const { roles, context } = await authorize(overrides);
      expect(() => roles.canActivate(context as never)).toThrow(
        ForbiddenException,
      );
    },
  );
  it('allows an explicitly assigned admin outside the company domain', async () => {
    const { roles, context } = await authorize(
      { email: 'owner@example.test' },
      { role: 'ADMIN', email: 'owner@example.test' },
    );
    expect(roles.canActivate(context as never)).toBe(true);
  });
  it('blocks suspended admins', async () => {
    await expect(
      authorize({}, { role: 'ADMIN', isSuspended: true }),
    ).rejects.toThrow(ForbiddenException);
  });
});
