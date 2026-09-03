import type { RequestHandler } from 'express';

type ForwardedHeader = string | string[] | undefined;

export function forwardedChainLength(value: ForwardedHeader): number {
  const normalized = Array.isArray(value) ? value.join(',') : value;
  if (!normalized) return 0;
  return normalized
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean).length;
}

export function isForwardedChainAllowed(
  value: ForwardedHeader,
  trustedProxyHops: number,
  isRender = false,
): boolean {
  // Render's edge defines the first X-Forwarded-For value as the real client
  // address. Internal edge hops can vary, so a fixed maximum rejects valid
  // requests and does not improve the trust decision on Render.
  if (isRender) return true;
  return forwardedChainLength(value) <= trustedProxyHops;
}

export function rejectUntrustedForwardedFor(
  trustedProxyHops: number,
  isRender = false,
): RequestHandler {
  return (request, response, next) => {
    if (
      !isForwardedChainAllowed(
        request.headers['x-forwarded-for'],
        trustedProxyHops,
        isRender,
      )
    ) {
      response.status(400).json({
        statusCode: 400,
        code: 'UNTRUSTED_FORWARDED_FOR',
        message: 'Untrusted forwarded address chain',
      });
      return;
    }
    next();
  };
}
