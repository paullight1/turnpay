import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { OtpService } from '../otp/otp.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly otpService: OtpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {}

  async register(registerDto: RegisterDto) {
    const email = registerDto.email.trim().toLowerCase();
    const phone = registerDto.phone.replace(/\s+/g, '').trim();
    const fullName = registerDto.fullName?.trim();

    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const existingPhone = await this.usersService.findByPhone(phone);
    if (existingPhone) {
      throw new ConflictException('Phone number already registered');
    }

    const { data, error } = await this.supabaseService.authClient.auth.signUp({
      email,
      password: registerDto.password,
      options: {
        data: {
          phone,
          ...(fullName ? { fullName } : {}),
        },
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    if (!data.user) {
      throw new BadRequestException('Registration failed');
    }

    await this.syncSupabaseAppRole(data.user.id, 'USER');
    const syncedUser = await this.supabaseService.syncUser(data.user);
    const user = await this.usersService.findOne(syncedUser.id);

    await this.otpService.sendOtp(phone);

    this.logger.info(
      { userId: user.id, event: 'user_registered' },
      'User registered via Supabase',
    );

    return {
      user,
      session: data.session,
    };
  }

  async login(loginDto: LoginDto) {
    const { data, error } =
      await this.supabaseService.authClient.auth.signInWithPassword({
        email: loginDto.email,
        password: loginDto.password,
      });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    if (!data.user || !data.session) {
      throw new UnauthorizedException('Login failed');
    }

    const syncedUser = await this.supabaseService.syncUser(data.user);

    this.logger.info(
      { userId: data.user.id, event: 'user_login' },
      'User logged in via Supabase',
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
      { userId, event: 'auth_bootstrap' },
      'User session bootstrapped',
    );

    return { user, wallets };
  }

  async refreshToken(refreshToken: string) {
    const { data, error } =
      await this.supabaseService.authClient.auth.refreshSession({
        refresh_token: refreshToken,
      });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return { session: data.session };
  }

  async logout(accessToken: string) {
    const { error } = await this.supabaseService
      .createUserScopedClient(accessToken)
      .auth.signOut({ scope: 'local' });

    if (error) {
      this.logger.warn({ error }, 'Supabase logout failed');
    }

    this.logger.info({ event: 'user_logout' }, 'User logged out');

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
      throw new UnauthorizedException('Current password is incorrect');
    }

    const { error } = await this.supabaseService
      .createUserScopedClient(accessToken)
      .auth.updateUser({
        password: newPassword,
      });

    if (error) {
      throw new BadRequestException(error.message);
    }

    this.logger.info(
      { userId, event: 'password_changed' },
      'Password changed via Supabase',
    );

    return { success: true, message: 'Password changed successfully' };
  }

  async sendOtp(phone: string) {
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      throw new BadRequestException('Phone number not registered');
    }

    return this.otpService.sendOtp(phone);
  }

  async verifyOtp(phone: string, otp: string) {
    const isValid = await this.otpService.verifyOtp(phone, otp);
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    return { success: true, message: 'OTP verified successfully' };
  }

  async sendPasswordResetEmail(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new BadRequestException('Email not registered');
    }

    const { error } =
      await this.supabaseService.authClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${this.configService.getOrThrow<string>('WEB_URL')}/reset-password`,
      });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { success: true, message: 'Password reset email sent' };
  }

  async resendConfirmationEmail(email: string) {
    const { error } = await this.supabaseService.authClient.auth.resend({
      type: 'signup',
      email,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { success: true, message: 'Confirmation email sent' };
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
}
