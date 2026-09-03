import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface ThrottledRequest {
  ip?: string;
  ips?: string[];
}

/**
 * Broad IP abuse limiter. It deliberately ignores authentication state so it
 * stays independent from the verified-user limiter applied to money routes.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  async onModuleInit() {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter(({ name }) => name === 'default');
  }

  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as ThrottledRequest;

    const forwarded =
      request.ips && request.ips.length > 0 ? request.ips[0] : request.ip;
    return Promise.resolve(`ip:${forwarded ?? 'unknown'}`);
  }
}
