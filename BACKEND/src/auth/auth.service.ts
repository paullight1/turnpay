import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "crypto";
import { SupabaseService } from "../supabase/supabase.service";
import { UsersService } from "../users/users.service";
import { WalletsService } from "../wallets/wallets.service";
import { OtpService } from "../otp/otp.service";
import { LoginDto, RegisterDto, ResetTransactionPinDto } from "./dto/auth.dto";
import { PinoLogger } from "nestjs-pino";
import { TransactionPinService } from "../common/services/transaction-pin.service";
import { PrismaService } from "../prisma/prisma.service";

type SessionContext = {
  ipAddress?: string;
  userAgent?: string;
  deviceName?: string;
};

const LOGIN_FAILURE_MESSAGE = "Unable to sign in with those credentials";
const REFRESH_FAILURE_MESSAGE = "Invalid or expired refresh token";
const RESET_RESPONSE_MESSAGE =
  "If an account exists, password reset instructions have been sent";
const OTP_RESPONSE_MESSAGE =
  "If the phone number is registered, an OTP was sent";
const CONFIRMATION_RESPONSE_MESSAGE =
  "If an account exists, a confirmation email was sent";
const REGISTRATION_GENERIC_MESSAGE = "Unable to complete registration";
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly otpService: OtpService,
    private readonly transactionPin: TransactionPinService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {}

  async register(registerDto: RegisterDto, context: SessionContext = {}) {
    const email = registerDto.email.trim().toLowerCase();
    const phone = registerDto.phone.replace(/\s+/g, "").trim();
    const fullName = registerDto.fullName?.trim();

    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new ConflictException(REGISTRATION_GENERIC_MESSAGE);
    }

    const existingPhone = await this.usersService.findByPhone(phone);
    if (existingPhone) {
      throw new ConflictException(REGISTRATION_GENERIC_MESSAGE);
    }

    const { data, error } = await this.supabaseService.authClient.auth.signUp({
      email,
      password: registerDto.password,
      options: {
        data: {
          phone,
          display_name: fullName || email.split('@')[0],
          full_name: fullName,
          name: fullName,
          ...(fullName ? { fullName } : {}),
        },
      },
    });

    if (error) {
      this.logger.warn(
        { email: registerDto.email, event: "user_registration_failed" },
        "Registration failed",
      );
      throw new BadRequestException(REGISTRATION_GENERIC_MESSAGE);
    }

    if (!data.user) {
      throw new BadRequestException("Registration failed");
    }

    await this.syncSupabaseAppRole(data.user.id, "USER");
    const syncedUser = await this.supabaseService.syncUser(data.user);
    const user = await this.usersService.findOne(syncedUser.id);
    await this.transactionPin.setPin(user.id, registerDto.transactionPin);
    await this.trackRefreshToken(user.id, data.session?.refresh_token, {
      ...context,
      deviceName: registerDto.deviceName,
    });

    await this.otpService.sendOtp(phone);

    this.logger.info(
      { userId: user.id, event: "user_registered", transactionPinSet: true },
      "User registered via Supabase",
    );

    return {
      user,
      session: data.session,
    };
  }

  async login(loginDto: LoginDto, context: SessionContext = {}) {
    const email = loginDto.email.trim().toLowerCase();
    const localUser = await this.usersService.findByEmail(email);
    const lockoutExpired =
      localUser?.lockedUntil && localUser.lockedUntil <= new Date();
    const currentFailedAttempts = lockoutExpired
      ? 0
      : (localUser?.failedAttempts ?? 0);

    if (localUser?.lockedUntil && localUser.lockedUntil > new Date()) {
      this.logger.warn(
        { userId: localUser.id, event: "login_blocked_locked_account" },
        "Locked account login attempt blocked",
      );
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }

    const { data, error } =
      await this.supabaseService.authClient.auth.signInWithPassword({
        email,
        password: loginDto.password,
      });

    if (error) {
      if (localUser) {
        await this.recordFailedLogin(localUser.id, currentFailedAttempts);
      }
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }

    if (!data.user || !data.session) {
      if (localUser) {
        await this.recordFailedLogin(localUser.id, currentFailedAttempts);
      }
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }

    const syncedUser = await this.supabaseService.syncUser(data.user);
    await this.resetFailedLoginState(syncedUser.id);
    await this.trackRefreshToken(syncedUser.id, data.session.refresh_token, {
      ...context,
      deviceName: loginDto.deviceName,
    });

    this.logger.info(
      { userId: data.user.id, event: "user_login" },
      "User logged in via Supabase",
    );

    return {
      user: await this.usersService.findOne(syncedUser.id),
      session: data.session,
    };
  }

  async bootstrap(userId: string) {
    const [user, wallets] = await Promise.all([
      this.usersService.findOne(userId),
      this.walletsService.getWallets(userId),
    ]);

    this.logger.info(
      { userId, event: "auth_bootstrap" },
      "User session bootstrapped",
    );

    return { user, wallets };
  }

  async refreshToken(refreshToken: string, context: SessionContext = {}) {
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

    await this.rotateRefreshToken(existingToken, data.session.refresh_token, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent || existingToken.userAgent || undefined,
      deviceName: context.deviceName || existingToken.deviceName || undefined,
    });

    return { session: data.session };
  }

  async logout(accessToken: string, refreshToken?: string) {
    const { error } = await this.supabaseService
      .createUserScopedClient(accessToken)
      .auth.signOut({ scope: "local" });

    if (error) {
      this.logger.warn({ error }, "Supabase logout failed");
    }

    if (refreshToken) {
      await this.revokeRefreshToken(refreshToken);
    }

    this.logger.info({ event: "user_logout" }, "User logged out");

    return { success: true };
  }

  async listSessions(userId: string) {
    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: "desc" },
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

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
      select: { id: true },
    });

    if (session) {
      await this.prisma.refreshToken.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
    }

    this.logger.info(
      { userId, sessionId, event: "auth_session_revoked" },
      "User session revoked",
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
        "Unable to update password with provided credentials",
      );
    }

    const { error } = await this.supabaseService
      .createUserScopedClient(accessToken)
      .auth.updateUser({
        password: newPassword,
      });

    if (error) {
      throw new BadRequestException(error.message);
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    this.logger.info(
      { userId, event: "password_changed" },
      "Password changed via Supabase",
    );

    return { success: true, message: "Password changed successfully" };
  }

  async sendOtp(phone: string) {
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      return { success: true, message: OTP_RESPONSE_MESSAGE };
    }

    await this.otpService.sendOtp(phone);
    return { success: true, message: OTP_RESPONSE_MESSAGE };
  }

  async verifyOtp(phone: string, otp: string) {
    const isValid = await this.otpService.verifyOtp(phone, otp);
    if (!isValid) {
      throw new BadRequestException("Invalid or expired OTP");
    }

    return { success: true, message: "OTP verified successfully" };
  }

  async sendPasswordResetEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      return { success: true, message: RESET_RESPONSE_MESSAGE };
    }

    const { error } =
      await this.supabaseService.authClient.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${this.configService.getOrThrow<string>("WEB_URL")}/reset-password`,
        },
      );

    if (error) {
      this.logger.warn(
        { userId: user.id, event: "password_reset_email_failed" },
        "Password reset email request failed",
      );
    }

    return { success: true, message: RESET_RESPONSE_MESSAGE };
  }

  async resendConfirmationEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await this.supabaseService.authClient.auth.resend({
      type: "signup",
      email: normalizedEmail,
    });

    if (error) {
      this.logger.warn(
        { event: "confirmation_email_failed" },
        "Confirmation email request failed",
      );
    }

    return { success: true, message: CONFIRMATION_RESPONSE_MESSAGE };
  }

  async setupTransactionPin(userId: string, pin: string) {
    const created = await this.transactionPin.setInitialPin(userId, pin);
    if (!created) {
      throw new ConflictException("Transaction PIN is already set");
    }

    await this.prisma.auditLog.create({
      data: {
        action: "transaction_pin_setup",
        targetType: "USER",
        targetId: userId,
        metadata: { actorUserId: userId },
      },
    });

    this.logger.info(
      { userId, event: "transaction_pin_setup" },
      "Transaction PIN set",
    );

    return { success: true, message: "Transaction PIN saved" };
  }

  async resetTransactionPin(userId: string, dto: ResetTransactionPinDto) {
    if (!dto.currentPin && !dto.otp) {
      throw new BadRequestException("Current PIN or OTP is required");
    }

    const verificationMethod = dto.currentPin ? "current_pin" : "otp";
    if (dto.currentPin) {
      await this.transactionPin.verifyPin(userId, dto.currentPin);
      if (dto.currentPin === dto.newPin) {
        throw new BadRequestException("New transaction PIN must be different");
      }
    } else {
      const user = await this.usersService.findOne(userId);
      const verified = await this.otpService.verifyOtp(user.phone, dto.otp!);
      if (!verified) {
        throw new UnauthorizedException(
          "Unable to reset transaction PIN with provided verification",
        );
      }
    }

    await this.transactionPin.setPin(userId, dto.newPin);
    const holdUntil = await this.transactionPin.setResetHold(userId);

    await this.prisma.auditLog.create({
      data: {
        action: "transaction_pin_reset",
        targetType: "USER",
        targetId: userId,
        metadata: {
          actorUserId: userId,
          verificationMethod,
          holdUntil,
        },
      },
    });

    this.logger.warn(
      { userId, event: "transaction_pin_reset", holdUntil },
      "Transaction PIN reset",
    );

    return {
      success: true,
      message: "Transaction PIN reset successfully",
      holdUntil,
    };
  }

  private async syncSupabaseAppRole(userId: string, role: "USER" | "ADMIN") {
    try {
      await this.supabaseService.setAuthAppRole(userId, role);
    } catch (error) {
      this.logger.warn(
        {
          userId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Unable to sync Supabase app_metadata role",
      );
    }
  }

  private async recordFailedLogin(
    userId: string,
    currentFailedAttempts: number,
  ) {
    const failedAttempts = currentFailedAttempts + 1;
    const lockedUntil =
      failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MS)
        : undefined;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedAttempts,
        lockedUntil: lockedUntil || null,
      },
    });

    this.logger.warn(
      {
        userId,
        event: lockedUntil ? "login_lockout_started" : "login_failed",
      },
      "Login failure recorded",
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
  ) {
    if (!refreshToken) {
      return;
    }

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        deviceId: randomUUID(),
        deviceName: this.resolveDeviceName(context),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        expiresAt: this.refreshTokenExpiry(),
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
    },
    nextRefreshToken: string | undefined,
    context: SessionContext,
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

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private refreshTokenExpiry() {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  }

  private resolveDeviceName(context: SessionContext) {
    return (
      context.deviceName?.trim().slice(0, 120) ||
      context.userAgent?.trim().slice(0, 120) ||
      "Unknown device"
    );
  }
}
