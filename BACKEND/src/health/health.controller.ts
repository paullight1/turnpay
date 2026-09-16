import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    const checks: Record<string, string> = {};
    let isReady = true;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'connected';
    } catch {
      checks.database = 'disconnected';
      isReady = false;
    }

    try {
      if (!this.redis.isAvailable()) {
        throw new Error('Redis is not ready');
      }
      await this.redis.getClient().ping();
      checks.redis = 'connected';
    } catch {
      checks.redis = 'disconnected';
      isReady = false;
    }

    if (this.isKycConfigured()) {
      checks.kyc = 'configured';
    } else {
      checks.kyc = 'misconfigured';
      isReady = false;
    }

    const response = {
      status: isReady ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    };

    if (!isReady) {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }

  // Backward-compatible readiness alias while deployment probes migrate to
  // the explicit endpoint.
  @Get()
  check() {
    return this.ready();
  }

  private isKycConfigured() {
    const provider = this.config.get<string>('KYC_PROVIDER');
    const piiKey = this.config.get<string>('PII_ENCRYPTION_KEY')?.trim() ?? '';
    if (piiKey.length < 32) return false;

    if (provider === 'monnify') {
      const apiKey = this.config.get<string>('MONNIFY_API_KEY')?.trim() ?? '';
      const secretKey =
        this.config.get<string>('MONNIFY_SECRET_KEY')?.trim() ?? '';
      return (
        apiKey.length > 0 &&
        secretKey.length > 0 &&
        this.isHttpsUrl(this.config.get<string>('MONNIFY_BASE_URL'))
      );
    }

    if (provider === 'ninja') {
      const clientKey =
        this.config.get<string>('NINJA_CLIENT_KEY')?.trim() ?? '';
      const clientSecret =
        this.config.get<string>('NINJA_CLIENT_SECRET')?.trim() ?? '';
      return (
        clientKey.length > 0 &&
        clientSecret.length > 0 &&
        this.isAllowedNinjaUrl(this.config.get<string>('NINJA_BASE_URL'))
      );
    }

    const apiKey = this.config.get<string>('YOUVERIFY_API_KEY')?.trim() ?? '';
    const webhookSecret =
      this.config.get<string>('YOUVERIFY_WEBHOOK_SECRET')?.trim() ?? '';
    return (
      provider === 'youverify' &&
      apiKey.length >= 16 &&
      webhookSecret.length >= 16 &&
      piiKey.length >= 32 &&
      this.isHttpsUrl(this.config.get<string>('YOUVERIFY_BASE_URL')) &&
      this.isHttpsUrl(this.config.get<string>('YOUVERIFY_WEBHOOK_URL'))
    );
  }

  private isHttpsUrl(value?: string) {
    if (!value) return false;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }

  private isAllowedNinjaUrl(value?: string) {
    if (!value) return false;
    try {
      const url = new URL(value);
      return new Set([
        'https://api.ninja.boucloud.io',
        'https://api.sandbox.ninja.boucloud.io',
      ]).has(url.origin);
    } catch {
      return false;
    }
  }
}
