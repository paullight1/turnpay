import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
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
    ensureRecoveryIdentity: jest.fn(),
    createUserScopedClient: jest.fn(() => scopedClient),
    getVerifiedProviderSessionId: jest.fn(),
    revokeProviderSession: jest.fn(),
    updatePasswordWithAccessToken: jest.fn(),
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
    assertOtpSendAllowed: jest.fn(),
    assertPasswordResetAllowed: jest.fn(),
  };

  const transactionPin = {
    setPin: jest.fn(),
    setInitialPin: jest.fn(),
    verifyPin: jest.fn(),
    setResetHold: jest.fn(),
    resetPinWithHold: jest.fn(),
    getStatus: jest.fn(),
  };

  const referrals = {
    ensureReferralCode: jest.fn(),
    recordReferral: jest.fn(),
  };

  const prisma = {
    user: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
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
      transactionPin as any,
      prisma as any,
      referrals as any,
      config as any,
      logger as any,
    );

    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        user: {
          update: prisma.user.update,
          updateMany: prisma.user.updateMany,
        },
        refreshToken: {
          create: prisma.refreshToken.create,
          update: prisma.refreshToken.update,
        },
      }),
    );
    prisma.user.update.mockResolvedValue({ failedAttempts: 1 });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
  });

  it('creates a staff verification request without a phone, PIN or local session', async () => {
    supabase.authClient.auth.signUp.mockResolvedValue({
      data: {
        user: { id: 'staff' },
        session: { access_token: 'must-not-return' },
      },
      error: null,
    });
    const result = await service.registerStaff({
      email: 'Support@trustpayhq.com',
      password: 'StrongPassword123',
    });
    expect(result).toEqual({ success: true, requiresEmailConfirmation: true });
    expect(supabase.authClient.auth.signUp).toHaveBeenCalledWith({
      email: 'support@trustpayhq.com',
      password: 'StrongPassword123',
      options: { data: {} },
    });
    expect(users.findByPhone).not.toHaveBeenCalled();
    expect(transactionPin.setPin).not.toHaveBeenCalled();
    expect(supabase.setAuthAppRole).not.toHaveBeenCalled();
    expect(supabase.syncUser).not.toHaveBeenCalled();
  });

  it('rejects lookalike domains before calling Supabase staff signup', async () => {
    await expect(
      service.registerStaff({
        email: 'staff@trustpayhq.com.evil.test',
        password: 'StrongPassword123',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(supabase.authClient.auth.signUp).not.toHaveBeenCalled();
  });

  it('registers users with public Supabase auth and stores role in app metadata', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.findByPhone.mockResolvedValue(null);
    supabase.authClient.auth.signUp.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'ada@example.com' },
        session: { access_token: 'token', refresh_token: 'refresh-token' },
      },
      error: null,
    });
    supabase.syncUser.mockResolvedValue({ id: 'user-1' });
    supabase.getVerifiedProviderSessionId.mockResolvedValue(
      'provider-session-1',
    );
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    referrals.ensureReferralCode.mockResolvedValue(undefined);
    referrals.recordReferral.mockResolvedValue(undefined);

    await service.register({
      email: 'ada@example.com',
      phone: '+2348012345678',
      password: 'Password1',
      transactionPin: '1234',
    });

    expect(supabase.authClient.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ada@example.com',
        options: { data: { phone: '+2348012345678' } },
      }),
    );
    expect(supabase.setAuthAppRole).toHaveBeenCalledWith('user-1', 'USER');
    expect(transactionPin.setPin).toHaveBeenCalledWith('user-1', '1234');
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerSessionId: 'provider-session-1',
      }),
    });
  });

  it('rejects registration when the phone is already registered locally', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.findByPhone.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.register({
        email: 'new@example.com',
        phone: '+2348012345678',
        password: 'Password1',
        transactionPin: '1234',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'PHONE_ALREADY_REGISTERED',
        message: 'That phone number is already linked to a TrustPay account.',
      },
    });

    expect(supabase.authClient.auth.signUp).not.toHaveBeenCalled();
  });

  it('returns the created session when registration OTP delivery is unavailable', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.findByPhone.mockResolvedValue(null);
    supabase.authClient.auth.signUp.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'ada@example.com' },
        session: {
          access_token: 'access-token',
          refresh_token: 'raw-refresh',
        },
      },
      error: null,
    });
    supabase.syncUser.mockResolvedValue({ id: 'user-1' });
    supabase.getVerifiedProviderSessionId.mockResolvedValue(
      'provider-session-1',
    );
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    referrals.ensureReferralCode.mockResolvedValue(undefined);
    referrals.recordReferral.mockResolvedValue(undefined);
    otp.sendOtp.mockRejectedValue(
      new ServiceUnavailableException('OTP delivery unavailable'),
    );

    await expect(
      service.register({
        email: 'ada@example.com',
        phone: '+2348012345678',
        password: 'Password1',
        transactionPin: '1234',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        authMode: 'supabase',
        otpDeliveryPending: true,
      }),
    );
  });

  it('returns an email-specific conflict when Supabase reports a duplicate email', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.findByPhone.mockResolvedValue(null);
    supabase.authClient.auth.signUp.mockResolvedValue({
      data: {},
      error: { code: 'email_exists', message: 'User already registered' },
    });

    await expect(
      service.register({
        email: 'new@example.com',
        phone: '+2348012345678',
        password: 'Password1',
        transactionPin: '1234',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'That email is already linked to a TrustPay account.',
      },
    });
  });

  it('returns a generic message when Supabase registration fails', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.findByPhone.mockResolvedValue(null);
    supabase.authClient.auth.signUp.mockResolvedValue({
      data: {},
      error: {
        message: 'User already registered',
        code: 'email_address_invalid',
        status: 400,
      },
    });

    await expect(
      service.register({
        email: 'new@example.com',
        phone: '+2348012345678',
        password: 'Password1',
        transactionPin: '1234',
      }),
    ).rejects.toThrow('Unable to complete registration');

    expect(transactionPin.setPin).not.toHaveBeenCalled();
    expect(users.findOne).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: 'user_registration_failed',
        providerCode: 'email_address_invalid',
        providerStatus: 400,
      },
      'Registration failed',
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: expect.anything() }),
      expect.any(String),
    );
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

    expect(supabase.updatePasswordWithAccessToken).not.toHaveBeenCalled();
  });

  it('updates the password through an explicit-token provider operation and revokes all sessions', async () => {
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    supabase.authClient.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'ada@example.com' },
        session: {
          access_token: 'reauth-token',
          refresh_token: 'reauth-refresh',
        },
      },
      error: null,
    });
    supabase.updatePasswordWithAccessToken.mockResolvedValue(undefined);
    supabase.revokeProviderSession.mockResolvedValue(undefined);

    await expect(
      service.changePassword(
        'user-1',
        'access-token',
        'CurrentPassword1',
        'NewPassword1',
      ),
    ).resolves.toEqual({
      success: true,
      message: 'Password changed successfully',
    });

    expect(supabase.updatePasswordWithAccessToken).toHaveBeenCalledWith(
      'access-token',
      'NewPassword1',
    );
    expect(supabase.revokeProviderSession).toHaveBeenCalledWith(
      'access-token',
      'global',
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('records failed login attempts and returns a safe auth error', async () => {
    users.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      failedAttempts: 0,
      lockedUntil: null,
    });
    supabase.authClient.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    });

    await expect(
      service.login({ email: 'ada@example.com', password: 'WrongPassword1' }),
    ).rejects.toThrow('Unable to sign in with those credentials');

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        lockedUntil: { lte: expect.any(Date) },
      },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
  });

  it('locks the account when an atomic failed-login increment reaches the threshold', async () => {
    users.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      failedAttempts: 4,
      lockedUntil: null,
    });
    prisma.user.update
      .mockResolvedValueOnce({ failedAttempts: 5 })
      .mockResolvedValueOnce({ id: 'user-1' });
    supabase.authClient.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    });

    await expect(
      service.login({ email: 'ada@example.com', password: 'WrongPassword1' }),
    ).rejects.toThrow('Unable to sign in with those credentials');

    expect(prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'user-1' },
      data: { lockedUntil: expect.any(Date) },
    });
  });

  it('blocks login while the account is locked', async () => {
    users.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(
      service.login({ email: 'ada@example.com', password: 'Password1' }),
    ).rejects.toThrow('Unable to sign in with those credentials');

    expect(supabase.authClient.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('tracks the login refresh token without storing the raw token', async () => {
    users.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      failedAttempts: 2,
      lockedUntil: null,
    });
    supabase.authClient.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'ada@example.com' },
        session: { access_token: 'access-token', refresh_token: 'raw-refresh' },
      },
      error: null,
    });
    supabase.syncUser.mockResolvedValue({ id: 'user-1' });
    supabase.getVerifiedProviderSessionId.mockResolvedValue(
      'provider-session-1',
    );
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });

    await service.login(
      {
        email: 'ada@example.com',
        password: 'Password1',
        deviceName: 'Ada iPhone',
      },
      { ipAddress: '127.0.0.1', userAgent: 'jest-agent' },
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        providerSessionId: 'provider-session-1',
        deviceName: 'Ada iPhone',
        userAgent: 'jest-agent',
        ipAddress: '127.0.0.1',
      }),
    });
    expect(prisma.refreshToken.create.mock.calls[0][0].data.tokenHash).not.toBe(
      'raw-refresh',
    );
  });

  it('rotates refresh tokens and revokes the previous token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'refresh-1',
      userId: 'user-1',
      tokenHash: 'old-hash',
      deviceId: 'device-1',
      deviceName: 'Ada iPhone',
      userAgent: 'jest-agent',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1' },
    });
    supabase.authClient.auth.refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          refresh_token: 'next-refresh',
        },
      },
      error: null,
    });
    supabase.getVerifiedProviderSessionId.mockResolvedValue(
      'provider-session-1',
    );
    prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-2' });

    await service.refreshToken('old-refresh', { ipAddress: '127.0.0.1' });

    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        providerSessionId: 'provider-session-1',
        deviceId: 'device-1',
        deviceName: 'Ada iPhone',
        ipAddress: '127.0.0.1',
      }),
    });
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'refresh-1' },
      data: expect.objectContaining({
        replacedByTokenId: 'refresh-2',
      }),
    });
  });

  it('returns a generic password reset response for unknown emails', async () => {
    users.findByEmail.mockResolvedValue(null);

    await expect(
      service.sendPasswordResetEmail('missing@example.com'),
    ).resolves.toEqual({
      success: true,
      message:
        'If an account exists, password reset instructions have been sent',
    });

    expect(
      supabase.authClient.auth.resetPasswordForEmail,
    ).not.toHaveBeenCalled();
  });

  it('normalizes password reset identities before throttling and lookup', async () => {
    users.findByEmail.mockResolvedValue(null);

    await service.sendPasswordResetEmail('  Ada@Example.com  ');

    expect(otp.assertPasswordResetAllowed).toHaveBeenCalledWith(
      'ada@example.com',
    );
    expect(users.findByEmail).toHaveBeenCalledWith('ada@example.com');
  });

  it('repairs a missing Supabase identity before requesting password recovery', async () => {
    users.findByEmail.mockResolvedValue({
      id: 'local-user-1',
      email: 'ada@example.com',
      phone: '+2348012345678',
      fullName: 'Ada Lovelace',
      role: 'USER',
    });
    supabase.ensureRecoveryIdentity.mockResolvedValue(undefined);
    supabase.authClient.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: null,
    });

    await expect(
      service.sendPasswordResetEmail('ada@example.com'),
    ).resolves.toEqual({
      success: true,
      message:
        'If an account exists, password reset instructions have been sent',
    });

    expect(supabase.ensureRecoveryIdentity).toHaveBeenCalledWith({
      id: 'local-user-1',
      email: 'ada@example.com',
      phone: '+2348012345678',
      fullName: 'Ada Lovelace',
      role: 'USER',
    });
    expect(supabase.authClient.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'ada@example.com',
      {
        redirectTo: 'http://localhost:3000/reset-password',
      },
    );
  });

  it('still requests recovery when legacy identity repair is unavailable', async () => {
    users.findByEmail.mockResolvedValue({
      id: 'local-user-1',
      email: 'ada@example.com',
      phone: '+2348012345678',
      fullName: 'Ada Lovelace',
      role: 'USER',
    });
    supabase.ensureRecoveryIdentity.mockRejectedValue(
      new Error('SUPABASE_SERVICE_ROLE_KEY is required'),
    );
    supabase.authClient.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: null,
    });

    await expect(
      service.sendPasswordResetEmail('ada@example.com'),
    ).resolves.toEqual({
      success: true,
      message:
        'If an account exists, password reset instructions have been sent',
    });

    expect(supabase.authClient.auth.resetPasswordForEmail).toHaveBeenCalled();
  });

  it('normalizes OTP send identities before throttling and lookup', async () => {
    users.findByPhone.mockResolvedValue(null);

    await service.sendOtp('  +2348012345678  ');

    expect(otp.assertOtpSendAllowed).toHaveBeenCalledWith('+2348012345678');
    expect(users.findByPhone).toHaveBeenCalledWith('+2348012345678');
  });

  it('logs out the caller session through Supabase with the explicit access token', async () => {
    supabase.getVerifiedProviderSessionId.mockResolvedValue(
      'provider-session-1',
    );
    supabase.revokeProviderSession.mockResolvedValue(undefined);

    await service.logout('access-token', 'refresh-token');

    expect(supabase.revokeProviderSession).toHaveBeenCalledWith(
      'access-token',
      'local',
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.any(String),
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(supabase.createUserScopedClient).not.toHaveBeenCalled();
  });

  it('marks the local session revoked before reporting provider logout failure', async () => {
    supabase.getVerifiedProviderSessionId.mockResolvedValue(
      'provider-session-1',
    );
    supabase.revokeProviderSession.mockRejectedValue(
      new Error('provider down'),
    );

    await expect(
      service.logout('access-token', 'refresh-token'),
    ).rejects.toThrow('Unable to complete logout');

    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('sets transaction PIN only when no PIN exists and audits setup', async () => {
    transactionPin.setInitialPin.mockResolvedValue(true);

    await service.setupTransactionPin('user-1', '1234');

    expect(transactionPin.setInitialPin).toHaveBeenCalledWith('user-1', '1234');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'transaction_pin_setup',
        targetType: 'USER',
        targetId: 'user-1',
      }),
    });
  });

  it('returns server-authoritative transaction PIN status and verifies the existing PIN', async () => {
    transactionPin.getStatus.mockResolvedValue({
      configured: true,
      pinLength: 4,
      resetHoldUntil: null,
      locked: false,
    });

    await expect(service.getTransactionPinStatus('user-1')).resolves.toEqual({
      configured: true,
      pinLength: 4,
      resetHoldUntil: null,
      locked: false,
    });
    await expect(
      service.verifyTransactionPin('user-1', '1234'),
    ).resolves.toEqual({ verified: true });
    expect(transactionPin.verifyPin).toHaveBeenCalledWith('user-1', '1234');
  });

  it('rejects transaction PIN setup when PIN already exists', async () => {
    transactionPin.setInitialPin.mockResolvedValue(false);

    await expect(
      service.setupTransactionPin('user-1', '1234'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transactionPin.setPin).not.toHaveBeenCalled();
  });

  it('resets transaction PIN with current PIN verification and reset hold', async () => {
    transactionPin.resetPinWithHold.mockResolvedValue({
      success: true,
      holdUntil: '2026-05-28T12:00:00.000Z',
    });

    await service.resetTransactionPin(
      'user-1',
      {
        currentPin: '1234',
        newPin: '5678',
      },
      {
        requestId: 'request-1',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      },
    );

    expect(transactionPin.verifyPin).toHaveBeenCalledWith('user-1', '1234');
    expect(transactionPin.resetPinWithHold).toHaveBeenCalledWith(
      'user-1',
      '5678',
      {
        verificationMethod: 'current_pin',
        requestId: 'request-1',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      },
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("resets transaction PIN with OTP for the authenticated user's phone", async () => {
    users.findOne.mockResolvedValue({ id: 'user-1', phone: '+2348012345678' });
    otp.verifyOtp.mockResolvedValue(true);
    transactionPin.resetPinWithHold.mockResolvedValue({
      success: true,
      holdUntil: '2026-05-28T12:00:00.000Z',
    });

    await service.resetTransactionPin('user-1', {
      otp: '123456',
      newPin: '5678',
    });

    expect(otp.verifyOtp).toHaveBeenCalledWith('+2348012345678', '123456');
    expect(transactionPin.resetPinWithHold).toHaveBeenCalledWith(
      'user-1',
      '5678',
      {
        verificationMethod: 'otp',
        requestId: 'unknown',
        ipAddress: 'unknown',
        userAgent: undefined,
      },
    );
  });

  it('does not reset transaction PIN without current PIN or OTP', async () => {
    await expect(
      service.resetTransactionPin('user-1', { newPin: '5678' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transactionPin.setPin).not.toHaveBeenCalled();
  });

  it('rejects transaction PIN reset when OTP verification fails', async () => {
    users.findOne.mockResolvedValue({ id: 'user-1', phone: '+2348012345678' });
    otp.verifyOtp.mockResolvedValue(false);

    await expect(
      service.resetTransactionPin('user-1', {
        otp: '123456',
        newPin: '5678',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(transactionPin.setPin).not.toHaveBeenCalled();
  });

  it('returns active sessions for a user', async () => {
    prisma.refreshToken.findMany.mockResolvedValue([
      {
        id: 'session-1',
        deviceId: 'device-1',
        deviceName: 'Chrome',
        userAgent: 'jest-agent',
        ipAddress: '127.0.0.1',
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    ]);

    const response = await service.listSessions('user-1');

    expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      orderBy: { lastUsedAt: 'desc' },
      select: expect.objectContaining({
        id: true,
        deviceId: true,
      }),
    });
    expect(response).toEqual({
      sessions: expect.arrayContaining([
        expect.objectContaining({
          id: 'session-1',
          deviceId: 'device-1',
          deviceName: 'Chrome',
        }),
      ]),
    });
  });

  it('revokes a user session when the session id matches', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue({ id: 'session-1' });
    prisma.refreshToken.update.mockResolvedValue({});

    const response = await service.revokeSession('user-1', 'session-1');

    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-1', userId: 'user-1', revokedAt: null },
      select: { id: true, providerSessionId: true },
    });
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(response).toEqual({ success: true });
  });

  it('returns success even when no session is revoked', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue(null);

    const response = await service.revokeSession('user-1', 'missing');

    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: { id: 'missing', userId: 'user-1', revokedAt: null },
      select: { id: true, providerSessionId: true },
    });
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    expect(response).toEqual({ success: true });
  });
});
