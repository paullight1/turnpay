import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';

// Infrastructure probes must remain observable when the rate-limit store is down.
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly inFlightProbes = new Map<string, Promise<unknown>>();
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
    const [database, redis] = await Promise.all([
      this.probe('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.probe('redis', async () => {
        if (!this.redis.isAvailable()) throw new Error('Redis is not ready');
        await this.redis.getClient().ping();
      }),
    ]);
    const checks: Record<string, string> = { database, redis };
    let isReady = database === 'connected' && redis === 'connected';

    if (this.isKycConfigured()) {
      checks.kyc = 'configured';
      if (this.config.get<string>('KYC_PROVIDER') === 'paystack')
        checks.paystack = 'configured_activation_unconfirmed';
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

  private async probe(name: string, check: () => Promise<unknown>) {
    // A timed-out driver operation may still be pending. Share it between
    // probes so repeated health requests cannot exhaust the connection pool.
    let operation = this.inFlightProbes.get(name);
    if (!operation) {
      operation = Promise.resolve().then(check);
      this.inFlightProbes.set(name, operation);
      const clear = () => {
        if (this.inFlightProbes.get(name) === operation) {
          this.inFlightProbes.delete(name);
        }
      };
      void operation.then(clear, clear);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Health probe timed out')),
            2000,
          );
        }),
      ]);
      return 'connected';
    } catch {
      return 'disconnected';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private isKycConfigured() {
    const provider = this.config.get<string>('KYC_PROVIDER');
    const piiKey = this.config.get<string>('PII_ENCRYPTION_KEY')?.trim() ?? '';
    if (piiKey.length < 32) return false;

    if (provider === 'paystack') {
      const secret =
        this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim() ?? '';
      return (
        /^sk_(test|live)_[A-Za-z0-9]+$/.test(secret) &&
        (this.config.get<string>('NODE_ENV') !== 'production' ||
          secret.startsWith('sk_live_'))
      );
    }
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

    return false;
  }

  private isHttpsUrl(value?: string) {
    if (!value) return false;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }
}
