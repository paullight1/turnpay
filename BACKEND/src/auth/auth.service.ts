import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { OtpService } from '../otp/otp.service';
import { RegisterDto, LoginDto, ChangePasswordDto } from './dto/auth.dto';
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
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const { data, error } = await this.supabaseService.client.auth.signUp({
      email: registerDto.email,
      password: registerDto.password,
      options: {
        data: {
          phone: registerDto.phone,
          role: 'USER',
        },
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    if (!data.user) {
      throw new BadRequestException('Registration failed');
    }

    const user = await this.usersService.create({
      id: data.user.id,
      email: data.user.email!,
      phone: registerDto.phone,
      password: '',
    });

    await this.walletsService.provisionWallets(user.id);

    await this.otpService.sendOtp(registerDto.phone);

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
      await this.supabaseService.client.auth.signInWithPassword({
        email: loginDto.email,
        password: loginDto.password,
      });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    if (!data.user || !data.session) {
      throw new UnauthorizedException('Login failed');
    }

    const user = await this.usersService.findByEmail(data.user.email!);

    if (!user) {
      const newUser = await this.usersService.create({
        id: data.user.id,
        email: data.user.email!,
        phone: data.user.user_metadata?.phone || '',
        password: '',
      });
      await this.walletsService.provisionWallets(newUser.id);
    }

    this.logger.info(
      { userId: data.user.id, event: 'user_login' },
      'User logged in via Supabase',
    );

    return {
      user: await this.usersService.findByEmail(data.user.email!),
      session: data.session,
    };
  }

  async refreshToken(refreshToken: string) {
    const { data, error } =
      await this.supabaseService.client.auth.refreshSession({
        refresh_token: refreshToken,
      });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return { session: data.session };
  }

  async logout(accessToken: string) {
    const { error } = await this.supabaseService.client.auth.signOut();

    if (error) {
      this.logger.warn({ error }, 'Supabase logout failed');
    }

    this.logger.info({ event: 'user_logout' }, 'User logged out');

    return { success: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const { error } = await this.supabaseService.client.auth.updateUser({
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
      await this.supabaseService.client.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.WEB_URL}/reset-password`,
      });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { success: true, message: 'Password reset email sent' };
  }

  async resendConfirmationEmail(email: string) {
    const { error } = await this.supabaseService.client.auth.resend({
      type: 'signup',
      email,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { success: true, message: 'Confirmation email sent' };
  }
}
