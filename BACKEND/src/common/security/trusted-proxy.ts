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
): boolean {
  return forwardedChainLength(value) <= trustedProxyHops;
}

export function rejectUntrustedForwardedFor(
  trustedProxyHops: number,
): RequestHandler {
  return (request, response, next) => {
    if (
      !isForwardedChainAllowed(
        request.headers['x-forwarded-for'],
        trustedProxyHops,
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
