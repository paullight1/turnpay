import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { OtpService } from '../otp/otp.service';
import {
  LoginDto,
  RegisterDto,
  ResetTransactionPinDto,
  StaffRegisterDto,
} from './dto/auth.dto';
import { PinoLogger } from 'nestjs-pino';
import type { RequestAuditContext } from '../common/services/request-audit-context';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralsService } from '../referrals/referrals.service';

type SessionContext = {
  ipAddress?: string;
  userAgent?: string;
  deviceName?: string;
};

const LOGIN_FAILURE_MESSAGE = 'Unable to sign in with those credentials';
const REFRESH_FAILURE_MESSAGE = 'Invalid or expired refresh token';
const RESET_RESPONSE_MESSAGE =
  'If an account exists, password reset instructions have been sent';
const OTP_RESPONSE_MESSAGE =
  'If the phone number is registered, an OTP was sent';
const CONFIRMATION_RESPONSE_MESSAGE =
  'If an account exists, a confirmation email was sent';
const REGISTRATION_GENERIC_MESSAGE = 'Unable to complete registration';
const REGISTRATION_EMAIL_CONFLICT = {
  code: 'EMAIL_ALREADY_REGISTERED',
  message: 'That email is already linked to a TrustPay account.',
} as const;
const REGISTRATION_PHONE_CONFLICT = {
  code: 'PHONE_ALREADY_REGISTERED',
  message: 'That phone number is already linked to a TrustPay account.',
} as const;
const REGISTRATION_RATE_LIMIT_MESSAGE =
  'Registration is temporarily rate limited. Please try again later.';
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOCAL_AUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const LOCAL_REFRESH_TOKEN_PREFIX = 'local_';

type AuthMode = 'supabase' | 'local';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly otpService: OtpService,
    private readonly transactionPin: TransactionPinService,
    private readonly prisma: PrismaService,
    private readonly referralsService: ReferralsService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {}

  async registerStaff(dto: StaffRegisterDto) {
    const email = this.normalizeEmail(dto.email);
    if (!/^[^@\s]+@trustpayhq\.com$/.test(email)) {
      throw new BadRequestException(
        'Staff signup requires a trustpayhq.com email address',
      );
    }
    const { error } = await this.supabaseService.authClient.auth.signUp({
      email,
      password: dto.password,
      options: {
        data: { ...(dto.fullName ? { full_name: dto.fullName.trim() } : {}) },
      },
    });
    if (error) {
      if (this.isSupabaseRateLimit(error)) {
        throw new HttpException(
          REGISTRATION_RATE_LIMIT_MESSAGE,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      this.logger.warn(
        { event: 'staff_signup_failed' },
        'Supabase staff signup failed',
      );
      throw new HttpException(
        'Staff signup is temporarily unavailable. Please try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // Do not mint a local fallback, confirm an email, or assign an ADMIN role.
    // The authenticated guard requires Supabase-confirmed domain ownership.
    this.logger.info(
      { event: 'staff_signup_requested' },
      'Staff email verification requested',
    );
    return { success: true, requiresEmailConfirmation: true };
  }

  async register(registerDto: RegisterDto, context: SessionContext = {}) {
    const email = this.normalizeEmail(registerDto.email);
    const phone = this.normalizePhone(registerDto.phone);
    const fullName = registerDto.fullName?.trim();

    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new ConflictException(REGISTRATION_EMAIL_CONFLICT);
    }

    const existingPhone = await this.usersService.findByPhone(phone);
    if (existingPhone) {
      throw new ConflictException(REGISTRATION_PHONE_CONFLICT);
    }

    const { data, error } = await this.supabaseService.authClient.auth.signUp({
      email,
      password: registerDto.password,
      options: {
        data: {
          phone,
          ...(fullName
            ? {
                display_name: fullName,
                full_name: fullName,
                name: fullName,
                fullName,
              }
            : {}),
        },
      },
    });

    if (error) {
      if (this.isSupabaseRateLimit(error)) {
        this.logger.warn(
          { event: 'user_registration_rate_limited' },
          'Registration rate limited by Supabase',
        );
        throw new HttpException(
          REGISTRATION_RATE_LIMIT_MESSAGE,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const providerError = error as {
        code?: unknown;
        status?: unknown;
      };
      if (
        providerError.code === 'user_already_exists' ||
        providerError.code === 'email_exists'
      ) {
        throw new ConflictException(REGISTRATION_EMAIL_CONFLICT);
      }

      this.logger.warn(
        {
          event: 'user_registration_failed',
          providerCode:
            typeof providerError.code === 'string'
              ? providerError.code
              : 'unknown',
          providerStatus:
            typeof providerError.status === 'number'
              ? providerError.status
              : undefined,
        },
        'Registration failed',
      );
      throw new BadRequestException(REGISTRATION_GENERIC_MESSAGE);
    }

    if (!data.user) {
      throw new BadRequestException('Registration failed');
    }

    await this.syncSupabaseAppRole(data.user.id, 'USER');
    const syncedUser = await this.supabaseService.syncUser(data.user);
    const user = await this.usersService.findOne(syncedUser.id);
    await this.referralsService.ensureReferralCode(user.id);
    await this.referralsService.recordReferral(
      user.id,
      registerDto.referralCode,
    );
    await this.transactionPin.setPin(user.id, registerDto.transactionPin);

    if (!data.session && this.isLocalAuthFallbackEnabled()) {
      const hashedPassword = await bcrypt.hash(registerDto.password, 12);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      const localSession = this.createLocalSession(user);
      await this.trackRefreshToken(user.id, localSession.refreshToken, {
        ...context,
        deviceName: registerDto.deviceName,
      });

      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });

      const otpDelivered = await this.trySendRegistrationOtp(phone);

      this.logger.info(
        {
          userId: user.id,
          event: 'user_registered_local_auth',
          transactionPinSet: true,
        },
        'User registered via local auth fallback',
      );

      return {
        user,
        session: localSession.session,
        authMode: 'local' as AuthMode,
        ...(otpDelivered ? {} : { otpDeliveryPending: true }),
      };
    }

    const providerSessionId = data.session?.access_token
      ? await this.supabaseService.getVerifiedProviderSessionId(
          data.session.access_token,
        )
      : undefined;
    await this.trackRefreshToken(
      user.id,
      data.session?.refresh_token,
      {
        ...context,
        deviceName: registerDto.deviceName,
      },
      providerSessionId,
    );

    const otpDelivered = await this.trySendRegistrationOtp(phone);

    this.logger.info(
      { userId: user.id, event: 'user_registered', transactionPinSet: true },
      'User registered via Supabase',
    );

    return {
      user,
      session: data.session,
      authMode: 'supabase' as AuthMode,
      ...(otpDelivered ? {} : { otpDeliveryPending: true }),
    };
  }

  async login(loginDto: LoginDto, context: SessionContext = {}) {
    const email = this.normalizeEmail(loginDto.email);
    const localUser = await this.usersService.findByEmail(email);
    if (localUser?.lockedUntil && localUser.lockedUntil > new Date()) {
      this.logger.warn(
        { userId: localUser.id, event: 'login_blocked_locked_account' },
        'Locked account login attempt blocked',
      );
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }

    if (
      this.isLocalAuthFallbackEnabled() &&
      localUser &&
      localUser.password &&
      (await bcrypt.compare(loginDto.password, localUser.password))
    ) {
      if (localUser.isSuspended) {
        throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
      }

      const localSession = this.createLocalSession(localUser);
      await this.resetFailedLoginState(localUser.id);
      await this.trackRefreshToken(localUser.id, localSession.refreshToken, {
        ...context,
        deviceName: loginDto.deviceName,
      });

      this.logger.info(
        { userId: localUser.id, event: 'user_login_local_fallback' },
        'User logged in via local auth fallback',
      );

      return {
        user: await this.usersService.findOne(localUser.id),
        session: localSession.session,
        authMode: 'local' as AuthMode,
      };
    }

    const { data, error } =
      await this.supabaseService.authClient.auth.signInWithPassword({
        email,
        password: loginDto.password,
      });

    if (error) {
      if (localUser) {
        await this.recordFailedLogin(localUser.id);
      }
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }

    if (!data.user || !data.session) {
      if (
        this.isLocalAuthFallbackEnabled() &&
        localUser &&
        localUser.password &&
        (await bcrypt.compare(loginDto.password, localUser.password))
      ) {
        if (localUser.isSuspended) {
          throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
        }

        const localSession = this.createLocalSession(localUser);
        await this.resetFailedLoginState(localUser.id);
        await this.trackRefreshToken(localUser.id, localSession.refreshToken, {
          ...context,
          deviceName: loginDto.deviceName,
        });

        this.logger.info(
          { userId: localUser.id, event: 'user_login_local_fallback' },
          'User logged in via local auth fallback',
        );

        return {
          user: await this.usersService.findOne(localUser.id),
          session: localSession.session,
          authMode: 'local' as AuthMode,
        };
      }

      if (localUser) {
        await this.recordFailedLogin(localUser.id);
      }
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }

    const syncedUser = await this.supabaseService.syncUser(data.user);
    await this.resetFailedLoginState(syncedUser.id);
    const providerSessionId =
      await this.supabaseService.getVerifiedProviderSessionId(
        data.session.access_token,
      );
    await this.trackRefreshToken(
      syncedUser.id,
      data.session.refresh_token,
      {
        ...context,
        deviceName: loginDto.deviceName,
      },
      providerSessionId,
    );

    this.logger.info(
      { userId: data.user.id, event: 'user_login' },
      'User logged in via Supabase',
    );

    return {
      user: await this.usersService.findOne(syncedUser.id),
      session: data.session,
      authMode: 'supabase' as AuthMode,
    };
  }

  async bootstrap(userId: string, canAccessAdmin = false) {
    void canAccessAdmin;
    const [user, wallets] = await Promise.all([
      this.usersService.findOne(userId),
      this.walletsService.getWallets(userId),
    ]);

    this.logger.info(
      { userId, event: 'auth_bootstrap' },
      'User session bootstrapped',
    );

    return {
      user: {
        ...user,
        canAccessAdmin: user.role === 'ADMIN',
      },
      wallets,
    };
  }

  async refreshToken(refreshToken: string, context: SessionContext = {}) {
    if (
      this.isLocalRefreshToken(refreshToken) &&
      this.isLocalAuthFallbackEnabled()
    ) {
      return this.refreshLocalToken(refreshToken, context);
    }

    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      include: { user: true },
    });

    if (
      !existingToken ||
      existingToken.revokedAt ||
      existingToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(REFRESH_FAILURE_MESSAGE);
    }

    const { data, error } =
      await this.supabaseService.authClient.auth.refreshSession({
        refresh_token: refreshToken,
      });

    if (error || !data.session) {
      await this.prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(REFRESH_FAILURE_MESSAGE);
    }

    const providerSessionId =
      await this.supabaseService.getVerifiedProviderSessionId(
        data.session.access_token,
      );
    await this.rotateRefreshToken(
      existingToken,
      data.session.refresh_token,
      {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent || existingToken.userAgent || undefined,
        deviceName: context.deviceName || existingToken.deviceName || undefined,
      },
      providerSessionId,
    );

    return { session: data.session };
  }

  async logout(accessToken: string, refreshToken?: string) {
    let providerSessionId: string | undefined;
    let providerRevocationFailed = false;

    try {
      providerSessionId =
        await this.supabaseService.getVerifiedProviderSessionId(accessToken);
      await this.supabaseService.revokeProviderSession(accessToken, 'local');
    } catch {
      providerRevocationFailed = true;
      this.logger.warn(
        { event: 'provider_logout_failed' },
        'Supabase logout failed',
      );
    }

    if (refreshToken) {
      await this.revokeRefreshToken(refreshToken);
    } else if (providerSessionId) {
      await this.revokeProviderSessionRecords(providerSessionId);
    }

    if (providerRevocationFailed) {
      throw new ServiceUnavailableException('Unable to complete logout');
    }

    this.logger.info({ event: 'user_logout' }, 'User logged out');

    return { success: true };
  }

  async listSessions(userId: string) {
    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        userAgent: true,
        ipAddress: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return { sessions };
  }

  async revokeSession(userId: string, sessionId: string, accessToken?: string) {
    const session = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
      select: { id: true, providerSessionId: true },
    });

    let providerRevocationFailed = false;
    if (session) {
      await this.prisma.refreshToken.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      await this.revokeProviderSessionRecords(session.providerSessionId);

      if (accessToken && session.providerSessionId) {
        try {
          const currentProviderSessionId =
            await this.supabaseService.getVerifiedProviderSessionId(
              accessToken,
            );
          if (currentProviderSessionId === session.providerSessionId) {
            await this.supabaseService.revokeProviderSession(
              accessToken,
              'local',
            );
          }
        } catch {
          providerRevocationFailed = true;
          this.logger.warn(
            { userId, sessionId, event: 'provider_session_revoke_failed' },
            'Provider session could not be revoked',
          );
        }
      }
    }

    if (providerRevocationFailed) {
      throw new ServiceUnavailableException(
        'Session revoked locally, but provider revocation failed',
      );
    }

    this.logger.info(
      { userId, sessionId, event: 'auth_session_revoked' },
      'User session revoked',
    );

    return { success: true };
  }

  async changePassword(
    userId: string,
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.usersService.findOne(userId);
    const reauth =
      await this.supabaseService.authClient.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

    if (reauth.error) {
      throw new UnauthorizedException(
        'Unable to update password with provided credentials',
      );
    }

    try {
      await this.supabaseService.updatePasswordWithAccessToken(
        accessToken,
        newPassword,
      );
    } catch {
      throw new BadRequestException(
        'Unable to update password with provided credentials',
      );
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    try {
      await this.supabaseService.revokeProviderSession(accessToken, 'global');
    } catch {
      this.logger.warn(
        { userId, event: 'provider_password_session_revoke_failed' },
        'Provider sessions could not be revoked after password change',
      );
      throw new ServiceUnavailableException(
        'Password changed, but sessions could not be fully revoked',
      );
    }

    this.logger.info(
      { userId, event: 'password_changed' },
      'Password changed via Supabase',
    );

    return { success: true, message: 'Password changed successfully' };
  }

  async sendOtp(phone: string) {
    const normalizedPhone = this.normalizePhone(phone);
    await this.otpService.assertOtpSendAllowed(normalizedPhone);

    const user = await this.usersService.findByPhone(normalizedPhone);
    if (!user) {
      return { success: true, message: OTP_RESPONSE_MESSAGE };
    }

    await this.otpService.sendOtp(normalizedPhone);
    return { success: true, message: OTP_RESPONSE_MESSAGE };
  }

  async verifyOtp(phone: string, otp: string) {
    const isValid = await this.otpService.verifyOtp(
      this.normalizePhone(phone),
      otp.trim(),
    );
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    return { success: true, message: 'OTP verified successfully' };
  }

  async sendPasswordResetEmail(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    await this.otpService.assertPasswordResetAllowed(normalizedEmail);
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      return { success: true, message: RESET_RESPONSE_MESSAGE };
    }

    try {
      await this.supabaseService.ensureRecoveryIdentity({
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role === 'ADMIN' ? 'ADMIN' : 'USER',
      });
    } catch (error) {
      // Recovery must remain generic and non-blocking. The admin client is
      // only needed to repair legacy local users; normal Supabase identities
      // can still receive a reset email with the publishable client.
      this.logger.warn(
        {
          userId: user.id,
          event: 'password_recovery_identity_repair_skipped',
          reason: error instanceof Error ? error.message : 'unknown_error',
        },
        'Password recovery identity repair was unavailable',
      );
    }

    const { error } =
      await this.supabaseService.authClient.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${this.configService.getOrThrow<string>('WEB_URL')}/reset-password`,
        },
      );

    if (error) {
      this.logger.warn(
        { userId: user.id, event: 'password_reset_email_failed' },
        'Password reset email request failed',
      );
    }

    return { success: true, message: RESET_RESPONSE_MESSAGE };
  }

  async resendConfirmationEmail(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const { error } = await this.supabaseService.authClient.auth.resend({
      type: 'signup',
      email: normalizedEmail,
    });

    if (error) {
      this.logger.warn(
        { event: 'confirmation_email_failed' },
        'Confirmation email request failed',
      );
    }

    return { success: true, message: CONFIRMATION_RESPONSE_MESSAGE };
  }

  async setupTransactionPin(
    userId: string,
    pin: string,
    auditContext?: RequestAuditContext,
  ) {
    const created = await this.transactionPin.setInitialPin(userId, pin);
    if (!created) {
      throw new ConflictException('Transaction PIN is already set');
    }

    await this.prisma.auditLog.create({
      data: {
        action: 'transaction_pin_setup',
        targetType: 'USER',
        targetId: userId,
        metadata: {
          actorUserId: userId,
          requestId: auditContext?.requestId,
          ipAddress: auditContext?.ipAddress,
          userAgent: auditContext?.userAgent,
        },
      },
    });

    this.logger.info(
      { userId, event: 'transaction_pin_setup' },
      'Transaction PIN set',
    );

    return { success: true, message: 'Transaction PIN saved' };
  }

  getTransactionPinStatus(userId: string) {
    return this.transactionPin.getStatus(userId);
  }

  async verifyTransactionPin(userId: string, pin: string) {
    await this.transactionPin.verifyPin(userId, pin);
    return { verified: true };
  }

  async resetTransactionPin(
    userId: string,
    dto: ResetTransactionPinDto,
    auditContext?: RequestAuditContext,
  ) {
    if (!dto.currentPin && !dto.otp) {
      throw new BadRequestException('Current PIN or OTP is required');
    }

    const verificationMethod: 'current_pin' | 'otp' = dto.currentPin
      ? 'current_pin'
      : 'otp';
    if (dto.currentPin) {
      await this.transactionPin.verifyPin(userId, dto.currentPin);
      if (dto.currentPin === dto.newPin) {
        throw new BadRequestException('New transaction PIN must be different');
      }
    } else {
      const user = await this.usersService.findOne(userId);
      const verified = await this.otpService.verifyOtp(user.phone, dto.otp!);
      if (!verified) {
        throw new UnauthorizedException(
          'Unable to reset transaction PIN with provided verification',
        );
      }
    }

    const reset = await this.transactionPin.resetPinWithHold(
      userId,
      dto.newPin,
      {
        verificationMethod,
        requestId: auditContext?.requestId ?? 'unknown',
        ipAddress: auditContext?.ipAddress ?? 'unknown',
        userAgent: auditContext?.userAgent,
      },
    );
    const holdUntil = reset.holdUntil;

    this.logger.warn(
      { userId, event: 'transaction_pin_reset', holdUntil },
      'Transaction PIN reset',
    );

    return {
      success: true,
      message: 'Transaction PIN reset successfully',
      holdUntil,
    };
  }

  private async syncSupabaseAppRole(userId: string, role: 'USER' | 'ADMIN') {
    try {
      await this.supabaseService.setAuthAppRole(userId, role);
    } catch (error) {
      this.logger.warn(
        {
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Unable to sync Supabase app_metadata role',
      );
    }
  }

  private async trySendRegistrationOtp(phone: string) {
    try {
      await this.otpService.assertOtpSendAllowed(phone);
      await this.otpService.sendOtp(phone);
      return true;
    } catch (error) {
      this.logger.warn(
        {
          event: 'registration_otp_delivery_pending',
          errorType: error instanceof HttpException ? error.name : 'unknown',
        },
        'Registration completed before OTP delivery was confirmed',
      );
      return false;
    }
  }

  private async recordFailedLogin(userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.user.updateMany({
        where: { id: userId, lockedUntil: { lte: now } },
        data: { failedAttempts: 0, lockedUntil: null },
      });

      const updated = await tx.user.update({
        where: { id: userId },
        data: { failedAttempts: { increment: 1 } },
        select: { failedAttempts: true },
      });
      const lockedUntil =
        updated.failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MS)
          : null;

      if (lockedUntil) {
        await tx.user.update({
          where: { id: userId },
          data: { lockedUntil },
        });
      }

      return { failedAttempts: updated.failedAttempts, lockedUntil };
    });

    this.logger.warn(
      {
        userId,
        event: result.lockedUntil ? 'login_lockout_started' : 'login_failed',
        failedAttempts: result.failedAttempts,
      },
      'Login failure recorded',
    );
  }

  private async resetFailedLoginState(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  private async trackRefreshToken(
    userId: string,
    refreshToken: string | undefined,
    context: SessionContext,
    providerSessionId?: string,
    expiresAt: Date = this.refreshTokenExpiry(),
  ) {
    if (!refreshToken) {
      return;
    }

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        providerSessionId,
        deviceId: randomUUID(),
        deviceName: this.resolveDeviceName(context),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        expiresAt,
      },
    });
  }

  private async rotateRefreshToken(
    existingToken: {
      id: string;
      userId: string;
      deviceId: string;
      deviceName: string | null;
      userAgent: string | null;
      providerSessionId?: string | null;
    },
    nextRefreshToken: string | undefined,
    context: SessionContext,
    providerSessionId?: string,
  ) {
    if (!nextRefreshToken) {
      await this.prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: { lastUsedAt: new Date() },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const replacement = await tx.refreshToken.create({
        data: {
          userId: existingToken.userId,
          tokenHash: this.hashToken(nextRefreshToken),
          providerSessionId:
            providerSessionId || existingToken.providerSessionId || undefined,
          deviceId: existingToken.deviceId,
          deviceName: this.resolveDeviceName(context),
          userAgent: context.userAgent,
          ipAddress: context.ipAddress,
          expiresAt: this.refreshTokenExpiry(),
        },
      });

      await tx.refreshToken.update({
        where: { id: existingToken.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenId: replacement.id,
          lastUsedAt: new Date(),
        },
      });
    });
  }

  private async revokeRefreshToken(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: this.hashToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeProviderSessionRecords(
    providerSessionId?: string | null,
  ) {
    if (!providerSessionId) {
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        providerSessionId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private isSupabaseRateLimit(error: unknown) {
    const candidate = error as {
      code?: string;
      status?: number;
      message?: string;
    };
    const message = candidate.message?.toLowerCase() ?? '';

    return (
      candidate.status === 429 ||
      candidate.code === 'over_email_send_rate_limit' ||
      message.includes('rate limit')
    );
  }

  private refreshTokenExpiry() {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  }

  private isLocalRefreshToken(refreshToken: string) {
    return refreshToken.startsWith(LOCAL_REFRESH_TOKEN_PREFIX);
  }

  private isLocalAuthFallbackEnabled() {
    return (
      process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test'
    );
  }

  private async refreshLocalToken(
    refreshToken: string,
    context: SessionContext = {},
  ) {
    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      include: { user: true },
    });

    if (
      !existingToken ||
      existingToken.revokedAt ||
      existingToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(REFRESH_FAILURE_MESSAGE);
    }

    if (existingToken.user.isSuspended) {
      throw new ForbiddenException('Account suspended');
    }

    const localSession = this.createLocalSession(existingToken.user);
    await this.rotateRefreshToken(existingToken, localSession.refreshToken, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent || existingToken.userAgent || undefined,
      deviceName: context.deviceName || existingToken.deviceName || undefined,
    });

    this.logger.info(
      { userId: existingToken.userId, event: 'user_refresh_local_auth' },
      'User session refreshed via local auth fallback',
    );

    return { session: localSession.session };
  }

  private createLocalSession(user: {
    id: string;
    email: string;
    role: string;
    fullName: string | null;
    phone: string;
    createdAt: Date;
    updatedAt?: Date;
  }) {
    const expiresAt =
      Math.floor(Date.now() / 1000) + LOCAL_AUTH_ACCESS_TOKEN_TTL_SECONDS;
    const accessToken = jwt.sign(
      {
        sub: user.id,
        role: user.role,
      },
      this.configService.getOrThrow<string>('JWT_SECRET'),
      { expiresIn: LOCAL_AUTH_ACCESS_TOKEN_TTL_SECONDS },
    );
    const refreshToken = `${LOCAL_REFRESH_TOKEN_PREFIX}${randomUUID()}`;

    return {
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        expires_in: LOCAL_AUTH_ACCESS_TOKEN_TTL_SECONDS,
        token_type: 'bearer',
        user: this.buildLocalSessionUser(user),
        authMode: 'local' as AuthMode,
      },
      refreshToken,
    };
  }

  private buildLocalSessionUser(user: {
    id: string;
    email: string;
    role: string;
    fullName: string | null;
    phone: string;
    createdAt: Date;
    updatedAt?: Date;
  }) {
    const now = new Date().toISOString();
    const updatedAt = (user.updatedAt ?? user.createdAt).toISOString();

    return {
      id: user.id,
      aud: 'authenticated',
      role: user.role,
      email: user.email,
      phone: user.phone,
      app_metadata: {
        provider: 'email',
        providers: ['email'],
        role: user.role,
      },
      user_metadata: {
        email: user.email,
        phone: user.phone,
        full_name: user.fullName ?? '',
        name: user.fullName ?? '',
      },
      identities: [],
      confirmed_at: now,
      email_confirmed_at: now,
      last_sign_in_at: now,
      created_at: user.createdAt.toISOString(),
      updated_at: updatedAt,
    };
  }

  private resolveDeviceName(context: SessionContext) {
    return (
      context.deviceName?.trim().slice(0, 120) ||
      context.userAgent?.trim().slice(0, 120) ||
      'Unknown device'
    );
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private normalizePhone(phone: string) {
    return phone.trim();
  }
}
