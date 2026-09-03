import type { RequestAuditContext } from '../common/services/request-audit-context';

export type InternalTransferRequestContext = Pick<
  RequestAuditContext,
  'requestId' | 'ipAddress' | 'userAgent'
> & {
  idempotencyKey: string;
};
