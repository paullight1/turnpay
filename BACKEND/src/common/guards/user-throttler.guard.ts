import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

interface ThrottledRequest {
  user?: { userId?: unknown };
  ip?: string;
  ips?: string[];
  headers?: { authorization?: unknown };
}

/**
 * Rate-limits per authenticated user, falling back to client IP for
 * unauthenticated routes (e.g. provider webhooks).
 *
 * Why not the default IP-only tracker: behind a reverse proxy every user can
 * share a single source IP (the proxy, or a carrier/corporate NAT), so an
 * IP-keyed limit would throttle unrelated users collectively. This guard runs
 * as a global guard — before the route-scoped JwtAuthGuard — so `req.user` is
 * not yet populated; we read the user id straight from the bearer token.
 *
 * The token is decoded, NOT verified, here: it only selects a rate-limit
 * bucket. Authentication is still enforced by JwtAuthGuard downstream, so a
 * forged `sub` only changes which bucket the caller is throttled under and
 * grants no access. The IP fallback relies on `trust proxy` being configured
 * so a real client IP (not the proxy address) is used.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as ThrottledRequest;

    const userIdClaim = request.user?.userId;
    const userId =
      (typeof userIdClaim === "string" && userIdClaim) ||
      this.extractUserIdFromAuthHeader(request);

    if (userId) {
      return Promise.resolve(`user:${userId}`);
    }

    const forwarded =
      request.ips && request.ips.length > 0 ? request.ips[0] : request.ip;
    return Promise.resolve(`ip:${forwarded ?? "unknown"}`);
  }

  private extractUserIdFromAuthHeader(
    req: ThrottledRequest,
  ): string | undefined {
    const header = req.headers?.authorization;
    if (typeof header !== "string") {
      return undefined;
    }

    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return undefined;
    }

    const segments = match[1].split(".");
    if (segments.length < 2) {
      return undefined;
    }

    try {
      const decoded = Buffer.from(segments[1], "base64url").toString("utf8");
      const payload = JSON.parse(decoded) as { sub?: unknown };

      return typeof payload.sub === "string" && payload.sub.length > 0
        ? payload.sub
        : undefined;
    } catch {
      return undefined;
    }
  }
}
