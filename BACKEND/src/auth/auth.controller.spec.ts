import { Request } from 'express';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    bootstrap: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
    listSessions: jest.fn(),
    revokeSession: jest.fn(),
    changePassword: jest.fn(),
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    resendConfirmationEmail: jest.fn(),
    setupTransactionPin: jest.fn(),
    resetTransactionPin: jest.fn(),
    getTransactionPinStatus: jest.fn(),
    verifyTransactionPin: jest.fn(),
  };

  const mockRequest = {
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('jest-agent'),
  } as unknown as Request;

  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(authService as never);
  });

  it('passes sanitized context to register', async () => {
    const payload = {
      email: 'test@example.com',
      password: 'Passw0rd!',
      phone: '+2348012345678',
      fullName: 'Tester',
      transactionPin: '1234',
    };
    const response = { user: { id: 'user-1' }, session: { access_token: 't' } };
    authService.register.mockResolvedValue(response);

    const result = await controller.register(payload, mockRequest);

    expect(authService.register).toHaveBeenCalledWith(payload, {
      ipAddress: '127.0.0.1',
      userAgent: 'jest-agent',
    });
    expect(result).toBe(response);
  });

  it('passes login request to auth service with request context', async () => {
    const payload = {
      email: 'test@example.com',
      password: 'Passw0rd!',
      deviceName: 'web',
    };
    const response = { user: { id: 'user-1' }, session: { access_token: 'x' } };
    authService.login.mockResolvedValue(response);

    const result = await controller.login(payload, mockRequest);

    expect(authService.login).toHaveBeenCalledWith(payload, {
      ipAddress: '127.0.0.1',
      userAgent: 'jest-agent',
    });
    expect(result).toBe(response);
  });

  it('passes refresh token and context through to refreshTokens', async () => {
    const payload = { refreshToken: 'refresh-token', deviceName: 'chrome' };
    const response = { session: { access_token: 'new' } };
    authService.refreshToken.mockResolvedValue(response);

    const result = await controller.refreshTokens(payload, mockRequest);

    expect(authService.refreshToken).toHaveBeenCalledWith('refresh-token', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest-agent',
      deviceName: 'chrome',
    });
    expect(result).toBe(response);
  });

  it('forwards logout access token and refresh token to auth service', async () => {
    authService.logout.mockResolvedValue({ success: true });

    const result = await controller.logout('Bearer abc.def', {
      refreshToken: 'refresh-token',
    });

    expect(authService.logout).toHaveBeenCalledWith('abc.def', 'refresh-token');
    expect(result).toEqual({ success: true });
  });

  it('forwards logout without refresh token when omitted', async () => {
    authService.logout.mockResolvedValue({ success: true });

    const result = await controller.logout('Bearer abc.def');

    expect(authService.logout).toHaveBeenCalledWith('abc.def', undefined);
    expect(result).toEqual({ success: true });
  });

  it('forwards bootstrap session data', async () => {
    const payload = { userId: 'user-1' };
    const response = { user: { id: 'user-1' }, wallets: [] };
    authService.bootstrap.mockResolvedValue(response);

    const result = await controller.bootstrap(payload);

    expect(authService.bootstrap).toHaveBeenCalledWith('user-1', false);
    expect(result).toBe(response);
  });

  it('forwards session list and revoke calls', async () => {
    authService.listSessions.mockResolvedValue([]);
    authService.revokeSession.mockResolvedValue({ revoked: true });

    const user = { userId: 'user-1' };
    const list = await controller.sessions(user);
    const revoke = await controller.revokeSession(
      user,
      'Bearer access-token',
      'session-1',
    );

    expect(authService.listSessions).toHaveBeenCalledWith('user-1');
    expect(authService.revokeSession).toHaveBeenCalledWith(
      'user-1',
      'session-1',
      'access-token',
    );
    expect(list).toEqual([]);
    expect(revoke).toEqual({ revoked: true });
  });

  it('forwards change-password and OTP operations', async () => {
    authService.changePassword.mockResolvedValue({ success: true });
    authService.sendOtp.mockResolvedValue({ message: 'otp sent' });
    authService.verifyOtp.mockResolvedValue({ valid: true });
    authService.sendPasswordResetEmail.mockResolvedValue({
      message: 'email sent',
    });
    authService.resendConfirmationEmail.mockResolvedValue({
      message: 'email sent',
    });

    const user = { userId: 'user-1' };
    const changePassword = await controller.changePassword(
      user,
      'Bearer access-token',
      { currentPassword: 'old', newPassword: 'new' },
    );
    const sendOtp = await controller.sendOtp({ email: 'ada@example.com' });
    const verifyOtp = await controller.verifyOtp({
      email: 'ada@example.com',
      otp: '000000',
    });
    const forgotPassword = await controller.forgotPassword({
      email: 'test@example.com',
    });
    const resendConfirmation = await controller.resendConfirmation({
      email: 'test@example.com',
    });

    expect(authService.changePassword).toHaveBeenCalledWith(
      'user-1',
      'access-token',
      'old',
      'new',
    );
    expect(authService.sendOtp).toHaveBeenCalledWith('ada@example.com');
    expect(authService.verifyOtp).toHaveBeenCalledWith(
      'ada@example.com',
      '000000',
    );
    expect(authService.sendPasswordResetEmail).toHaveBeenCalledWith(
      'test@example.com',
    );
    expect(authService.resendConfirmationEmail).toHaveBeenCalledWith(
      'test@example.com',
    );
    expect(changePassword).toEqual({ success: true });
    expect(sendOtp).toEqual({ message: 'otp sent' });
    expect(verifyOtp).toEqual({ valid: true });
    expect(forgotPassword).toEqual({ message: 'email sent' });
    expect(resendConfirmation).toEqual({ message: 'email sent' });
  });

  it('forwards transaction pin operations', async () => {
    const user = { userId: 'user-1' };
    const request = {
      id: 'request-pin-1',
      ip: '203.0.113.9',
      headers: { 'user-agent': 'jest-agent' },
      socket: {},
    } as never;
    authService.setupTransactionPin.mockResolvedValue({ success: true });
    authService.resetTransactionPin.mockResolvedValue({ success: true });
    authService.getTransactionPinStatus.mockResolvedValue({
      configured: true,
      pinLength: 4,
      resetHoldUntil: null,
      locked: false,
    });
    authService.verifyTransactionPin.mockResolvedValue({ verified: true });

    const setup = await controller.setupTransactionPin(
      user,
      {
        pin: '1234',
      },
      request,
    );
    const reset = await controller.resetTransactionPin(
      user,
      {
        currentPin: '1234',
        newPin: '5678',
        otp: '000000',
      },
      request,
    );
    const status = await controller.getTransactionPinStatus(user);
    const verified = await controller.verifyTransactionPin(user, {
      pin: '1234',
    });

    expect(authService.setupTransactionPin).toHaveBeenCalledWith(
      'user-1',
      '1234',
      expect.objectContaining({
        actorId: 'user-1',
        requestId: 'request-pin-1',
        ipAddress: '203.0.113.9',
        userAgent: 'jest-agent',
      }),
    );
    expect(authService.resetTransactionPin).toHaveBeenCalledWith(
      'user-1',
      {
        currentPin: '1234',
        newPin: '5678',
        otp: '000000',
      },
      expect.objectContaining({
        actorId: 'user-1',
        requestId: 'request-pin-1',
      }),
    );
    expect(setup).toEqual({ success: true });
    expect(reset).toEqual({ success: true });
    expect(status).toEqual({
      configured: true,
      pinLength: 4,
      resetHoldUntil: null,
      locked: false,
    });
    expect(verified).toEqual({ verified: true });
  });
});
