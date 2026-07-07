import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import {
  RegisterDto,
  LoginDto,
  LogoutDto,
  ChangePasswordDto,
  EmailDto,
  PhoneDto,
  RefreshTokenDto,
  ResetTransactionPinDto,
  SetTransactionPinDto,
  VerifyOtpDto,
} from "./dto/auth.dto";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { SupabaseAuthGuard } from "./guards/supabase-auth.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto, @Req() request: Request) {
    return this.authService.register(
      registerDto,
      this.getSessionContext(request),
    );
  }

  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() request: Request) {
    return this.authService.login(loginDto, this.getSessionContext(request));
  }

  @Post("bootstrap")
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async bootstrap(@CurrentUser() user: { userId: string }) {
    return this.authService.bootstrap(user.userId);
  }

  @Post("refresh")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async refreshTokens(@Body() dto: RefreshTokenDto, @Req() request: Request) {
    return this.authService.refreshToken(dto.refreshToken, {
      ...this.getSessionContext(request),
      deviceName: dto.deviceName,
    });
  }

  @Post("logout")
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Headers("authorization") authorization: string,
    @Body() dto?: LogoutDto,
  ) {
    return this.authService.logout(
      this.extractBearerToken(authorization),
      dto?.refreshToken,
    );
  }

  @Get("sessions")
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sessions(@CurrentUser() user: { userId: string }) {
    return this.authService.listSessions(user.userId);
  }

  @Delete("sessions/:sessionId")
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() user: { userId: string },
    @Param("sessionId") sessionId: string,
  ) {
    return this.authService.revokeSession(user.userId, sessionId);
  }

  @Post("change-password")
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: { userId: string },
    @Headers("authorization") authorization: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.userId,
      this.extractBearerToken(authorization),
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post("otp/send")
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() dto: PhoneDto) {
    return this.authService.sendOtp(dto.phone);
  }

  @Post("otp/verify")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto.phone, verifyOtpDto.otp);
  }

  @Post("forgot-password")
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: EmailDto) {
    return this.authService.sendPasswordResetEmail(dto.email);
  }

  @Post("resend-confirmation")
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @HttpCode(HttpStatus.OK)
  async resendConfirmation(@Body() dto: EmailDto) {
    return this.authService.resendConfirmationEmail(dto.email);
  }

  @Post("transaction-pin")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  @HttpCode(HttpStatus.OK)
  async setupTransactionPin(
    @CurrentUser() user: { userId: string },
    @Body() dto: SetTransactionPinDto,
  ) {
    return await this.authService.setupTransactionPin(user.userId, dto.pin);
  }

  @Patch("transaction-pin")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  @HttpCode(HttpStatus.OK)
  async resetTransactionPin(
    @CurrentUser() user: { userId: string },
    @Body() dto: ResetTransactionPinDto,
  ) {
    return await this.authService.resetTransactionPin(user.userId, dto);
  }

  private extractBearerToken(authorization?: string) {
    return authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
  }

  private getSessionContext(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.get("user-agent"),
    };
  }
}
