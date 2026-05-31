import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../redis/redis.service";
import { createHash, randomInt } from "crypto";
import { PinoLogger } from "nestjs-pino";
import { maskPhone } from "../common/utils/masking";

@Injectable()
export class OtpService {
  private readonly expirySeconds: number;
  private readonly otpLength: number;
  private readonly devOtpCode?: string;
  private readonly maxAttempts = 3;

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OtpService.name);
    this.expirySeconds =
      parseInt(this.configService.get<string>("OTP_EXPIRES_IN") || "5") * 60;
    this.otpLength = parseInt(
      this.configService.get<string>("OTP_LENGTH") || "6",
    );
    const configuredDevCode = this.configService.get<string>("OTP_DEV_CODE");
    this.devOtpCode =
      this.configService.get<string>("NODE_ENV") !== "production" &&
      configuredDevCode &&
      /^\d{6}$/.test(configuredDevCode)
        ? configuredDevCode
        : undefined;
  }

  async sendOtp(phone: string): Promise<{ success: boolean; message: string }> {
    const code = this.devOtpCode ?? this.generateOtp();
    const phoneHash = this.hashPhone(phone);
    const key = `otp:${phoneHash}`;

    await this.redis.set(
      key,
      JSON.stringify({ code, attempts: 0 }),
      this.expirySeconds,
    );

    this.logger.info(
      {
        phoneHash,
        phoneMasked: maskPhone(phone),
        expiresInSeconds: this.expirySeconds,
      },
      "OTP generated",
    );
    if (this.devOtpCode) {
      this.logger.warn("Development OTP override is enabled");
    }

    return {
      success: true,
      message: "OTP sent successfully",
    };
  }

  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const phoneHash = this.hashPhone(phone);
    const phoneMasked = maskPhone(phone);
    const key = `otp:${phoneHash}`;
    const raw = await this.redis.get(key);

    if (!raw) {
      this.logger.warn({ phoneHash, phoneMasked }, "OTP not found");
      return false;
    }

    const record = JSON.parse(raw) as { code: string; attempts: number };
    const isValidDevCode = this.devOtpCode && otp === this.devOtpCode;

    if (record.attempts >= this.maxAttempts) {
      await this.redis.del(key);
      this.logger.warn(
        { phoneHash, phoneMasked },
        "Maximum OTP verification attempts exceeded",
      );
      return false;
    }

    if (record.code !== otp && !isValidDevCode) {
      record.attempts++;
      await this.redis.set(key, JSON.stringify(record), this.expirySeconds);
      this.logger.warn(
        {
          phoneHash,
          phoneMasked,
          attempt: record.attempts,
          maxAttempts: this.maxAttempts,
        },
        "Invalid OTP submitted",
      );
      return false;
    }

    await this.redis.del(key);
    this.logger.info({ phoneHash, phoneMasked }, "OTP verified successfully");
    return true;
  }

  private generateOtp(): string {
    const min = Math.pow(10, this.otpLength - 1);
    const max = Math.pow(10, this.otpLength) - 1;
    return String(randomInt(min, max + 1));
  }

  private hashPhone(phone: string): string {
    return createHash("sha256").update(phone).digest("hex");
  }
}
