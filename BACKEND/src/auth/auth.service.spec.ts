import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService Supabase integration', () => {
  const scopedClient = {
    auth: {
      signOut: jest.fn(),
      updateUser: jest.fn(),
    },
  };

  const supabase = {
    authClient: {
      auth: {
        signUp: jest.fn(),
        signInWithPassword: jest.fn(),
        refreshSession: jest.fn(),
        resetPasswordForEmail: jest.fn(),
        resend: jest.fn(),
      },
    },
    syncUser: jest.fn(),
    createUserScopedClient: jest.fn(() => scopedClient),
    setAuthAppRole: jest.fn(),
  };

  const users = {
    findByEmail: jest.fn(),
    findByPhone: jest.fn(),
    findOne: jest.fn(),
  };

  const wallets = {
    getWallets: jest.fn(),
  };

  const otp = {
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
  };

  const config = {
    getOrThrow: jest.fn(() => 'http://localhost:3000'),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      supabase as any,
      users as any,
      wallets as any,
      otp as any,
      config as any,
      logger as any,
    );
  });

  it('registers users with public Supabase auth and stores role in app metadata', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.findByPhone.mockResolvedValue(null);
    supabase.authClient.auth.signUp.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'ada@example.com' },
        session: { access_token: 'token' },
      },
      error: null,
    });
    supabase.syncUser.mockResolvedValue({ id: 'user-1' });
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });

    await service.register({
      email: 'ada@example.com',
      phone: '+2348012345678',
      password: 'Password1',
    });

    expect(supabase.authClient.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ada@example.com',
        options: { data: { phone: '+2348012345678' } },
      }),
    );
    expect(supabase.setAuthAppRole).toHaveBeenCalledWith('user-1', 'USER');
  });

  it('rejects registration when the phone is already registered locally', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.findByPhone.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.register({
        email: 'new@example.com',
        phone: '+2348012345678',
        password: 'Password1',
      }),
    ).rejects.toThrow('Phone number already registered');

    expect(supabase.authClient.auth.signUp).not.toHaveBeenCalled();
  });

  it('requires the current password before changing password', async () => {
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    supabase.authClient.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid credentials' },
    });

    await expect(
      service.changePassword(
        'user-1',
        'access-token',
        'WrongPassword1',
        'NewPassword1',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(scopedClient.auth.updateUser).not.toHaveBeenCalled();
  });

  it('logs out the caller session with a user scoped Supabase client', async () => {
    scopedClient.auth.signOut.mockResolvedValue({ error: null });

    await service.logout('access-token');

    expect(supabase.createUserScopedClient).toHaveBeenCalledWith(
      'access-token',
    );
    expect(scopedClient.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
