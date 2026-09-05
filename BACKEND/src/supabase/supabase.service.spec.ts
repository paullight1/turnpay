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
