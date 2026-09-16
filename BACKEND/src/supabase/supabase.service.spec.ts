import { SupabaseService } from './supabase.service';

describe('SupabaseService recovery identity repair', () => {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'SUPABASE_URL') return 'https://example.supabase.co';
      if (key === 'SUPABASE_ANON_KEY') return 'test-publishable-key';
      throw new Error(`Unexpected config key: ${key}`);
    }),
    get: jest.fn((key: string) => {
      if (key === 'SUPABASE_PUBLISHABLE_KEY') return 'test-publishable-key';
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-role-key';
      return undefined;
    }),
  };
  const prisma = {};
  const logger = { info: jest.fn(), warn: jest.fn() };
  const candidate = {
    id: 'local-user-1',
    email: 'ada@example.com',
    phone: '+2348012345678',
    fullName: 'Ada Lovelace',
    role: 'USER' as const,
  };

  function createService() {
    return new SupabaseService(
      config as never,
      prisma as never,
      logger as never,
    );
  }

  it('keeps an existing legacy Supabase identity', async () => {
    const getUserById = jest.fn().mockResolvedValue({
      data: { user: { id: candidate.id } },
      error: null,
    });
    const createUser = jest.fn();
    const service = createService();
    service.adminClient = {
      auth: { admin: { getUserById, createUser } },
    } as never;

    await service.ensureRecoveryIdentity(candidate);

    expect(getUserById).toHaveBeenCalledWith(candidate.id);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('creates an inaccessible temporary identity when the legacy identity is missing', async () => {
    const getUserById = jest.fn().mockResolvedValue({
      data: { user: null },
      error: { code: 'user_not_found', status: 404 },
    });
    const createUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'supabase-user-1' } },
      error: null,
    });
    const service = createService();
    service.adminClient = {
      auth: { admin: { getUserById, createUser } },
    } as never;

    await service.ensureRecoveryIdentity(candidate);

    expect(createUser).toHaveBeenCalledTimes(1);
    const attributes = createUser.mock.calls[0][0] as Record<string, unknown>;
    expect(attributes).toEqual(
      expect.objectContaining({
        email: candidate.email,
        email_confirm: true,
        app_metadata: { role: 'USER' },
        user_metadata: {
          phone: candidate.phone,
          full_name: candidate.fullName,
        },
      }),
    );
    expect(attributes.password).toEqual(expect.any(String));
    expect((attributes.password as string).length).toBeGreaterThanOrEqual(40);
  });

  it('accepts a concurrent repair that already created the email identity', async () => {
    const getUserById = jest.fn().mockResolvedValue({
      data: { user: null },
      error: { code: 'user_not_found', status: 404 },
    });
    const createUser = jest.fn().mockResolvedValue({
      data: { user: null },
      error: { code: 'user_already_exists', status: 422 },
    });
    const service = createService();
    service.adminClient = {
      auth: { admin: { getUserById, createUser } },
    } as never;

    await expect(
      service.ensureRecoveryIdentity(candidate),
    ).resolves.toBeUndefined();
  });
});

describe('SupabaseService provider session operations', () => {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'SUPABASE_URL') return 'https://example.supabase.co';
      if (key === 'SUPABASE_ANON_KEY') return 'test-publishable-key';
      throw new Error(`Unexpected config key: ${key}`);
    }),
    get: jest.fn((key: string) => {
      if (key === 'SUPABASE_PUBLISHABLE_KEY') return 'test-publishable-key';
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') return undefined;
      return undefined;
    }),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };

  it('revokes the provider session with the explicit access token', async () => {
    const service = new SupabaseService(
      config as never,
      {} as never,
      logger as never,
    );
    const originalFetch = global.fetch;
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: jest.fn(),
    });
    global.fetch = fetch as never;

    try {
      await service.revokeProviderSession('access-token', 'local');
    } finally {
      global.fetch = originalFetch;
    }

    expect(fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/logout?scope=local',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'test-publishable-key',
          Authorization: 'Bearer access-token',
        }),
      }),
    );
  });

  it('updates a password through the provider user endpoint with the explicit access token', async () => {
    const service = new SupabaseService(
      config as never,
      {} as never,
      logger as never,
    );
    const originalFetch = global.fetch;
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ user: { id: 'user-1' } }),
    });
    global.fetch = fetch as never;

    try {
      await service.updatePasswordWithAccessToken(
        'access-token',
        'NewPassword1',
      );
    } finally {
      global.fetch = originalFetch;
    }

    expect(fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/user',
      expect.objectContaining({
        method: 'PUT',
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          apikey: 'test-publishable-key',
          Authorization: 'Bearer access-token',
        }),
        body: JSON.stringify({ password: 'NewPassword1' }),
      }),
    );
  });
});
