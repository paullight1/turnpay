import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
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
    missingLocalUser = false,
  ) {
    const current = { ...account, ...accountOverrides };
    const supabase = {
      verifyToken: jest.fn().mockResolvedValue({ ...identity, ...overrides }),
      syncUser: jest.fn().mockResolvedValue(current),
      getVerifiedProviderSessionId: jest
        .fn()
        .mockResolvedValue('provider-session-1'),
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(current) },
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({ id: 'app-session-1' }),
      },
    };
    if (missingLocalUser) prisma.user.findUnique.mockResolvedValueOnce(null);
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
    return { request, roles, context, supabase };
  }
  it('does not rewrite an existing user and wallets on every authenticated read', async () => {
    const { supabase } = await authorize();
    expect(supabase.verifyToken).toHaveBeenCalledTimes(1);
    expect(supabase.getVerifiedProviderSessionId).toHaveBeenCalledTimes(1);
    expect(supabase.syncUser).not.toHaveBeenCalled();
  });
  it('still synchronizes a verified identity when the local user is missing', async () => {
    const { supabase, request } = await authorize({}, {}, true);
    expect(supabase.syncUser).toHaveBeenCalledWith(identity);
    expect(request.user).toEqual(
      expect.objectContaining({ userId: identity.id }),
    );
  });
  it('starts independent provider identity and session verification together', async () => {
    let release!: (value: typeof identity) => void;
    const identityResult = new Promise<typeof identity>((resolve) => {
      release = resolve;
    });
    const supabase = {
      verifyToken: jest.fn().mockReturnValue(identityResult),
      getVerifiedProviderSessionId: jest.fn().mockResolvedValue('session-1'),
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(account) },
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({ id: 'session-1' }),
      },
    };
    const guard = new JwtAuthGuard(
      supabase as never,
      prisma as never,
      {} as never,
    );
    const authorization = guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
      }),
    } as never);
    const verificationStarted =
      supabase.getVerifiedProviderSessionId.mock.calls.length;
    release(identity);
    await authorization;
    expect(verificationStarted).toBe(1);
  });
  it('does not grant admin access to a verified company email without the ADMIN role', async () => {
    const { request, roles, context } = await authorize();
    expect(request.user).toEqual(
      expect.objectContaining({ role: 'USER', canAccessAdmin: false }),
    );
    expect(() => roles.canActivate(context as never)).toThrow(
      ForbiddenException,
    );
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

  it('rejects a provider token whose session was revoked locally', async () => {
    const current = { ...account, role: 'ADMIN' };
    const supabase = {
      verifyToken: jest.fn().mockResolvedValue(identity),
      syncUser: jest.fn().mockResolvedValue(current),
      getVerifiedProviderSessionId: jest
        .fn()
        .mockResolvedValue('provider-session-revoked'),
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(current) },
      refreshToken: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const request = {
      headers: { authorization: 'Bearer refreshed-provider-token' },
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

    await expect(guard.canActivate(context as never)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'staff-id',
        providerSessionId: 'provider-session-revoked',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
  });
});
