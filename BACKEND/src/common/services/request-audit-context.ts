import { createHash, randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../types/request-context';

export type RequestAuditContext = {
  requestId: string;
  ipAddress: string;
  userAgent?: string;
  actorId?: string;
  idempotencyKeyDigest?: string;
};

export function createRequestAuditContext(
  request: AuthenticatedRequest,
  options: { actorId?: string; idempotencyKey?: string } = {},
): RequestAuditContext {
  const requestId =
    request.id === undefined || request.id === null
      ? randomUUID()
      : String(request.id).slice(0, 128);
  const userAgentHeader =
    request.headers?.['user-agent'] ?? request.get?.('user-agent');
  const userAgent =
    typeof userAgentHeader === 'string'
      ? userAgentHeader.trim().slice(0, 256)
      : undefined;
  const ipAddress =
    request.ip?.trim().slice(0, 64) ||
    request.socket?.remoteAddress?.trim().slice(0, 64) ||
    'unknown';

  return {
    requestId,
    ipAddress,
    ...(userAgent && { userAgent }),
    ...(options.actorId && { actorId: options.actorId }),
    ...(options.idempotencyKey && {
      idempotencyKeyDigest: createHash('sha256')
        .update(options.idempotencyKey)
        .digest('hex')
        .slice(0, 12),
    }),
  };
}
