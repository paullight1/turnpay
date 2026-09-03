import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface VerifiedUserRequest {
  user?: { userId?: unknown };
}

/**
 * Money-route limiter keyed only by an identity verified by JwtAuthGuard.
 * It never falls back to an IP or parses bearer-token claims itself.
 */
@Injectable()
export class AuthenticatedUserThrottlerGuard extends ThrottlerGuard {
  async onModuleInit() {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter(
      ({ name }) => name === 'verifiedUser',
    );
  }

  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const userIdClaim = (req as VerifiedUserRequest).user?.userId;
    if (typeof userIdClaim !== 'string' || userIdClaim.length === 0) {
      return Promise.reject(
        new UnauthorizedException('Verified user identity is required'),
      );
    }
    return Promise.resolve(`user:${userIdClaim}`);
  }
}
