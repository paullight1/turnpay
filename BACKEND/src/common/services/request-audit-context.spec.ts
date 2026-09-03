import { createRequestAuditContext } from './request-audit-context';

describe('createRequestAuditContext', () => {
  it('normalizes a direct client request', () => {
    expect(
      createRequestAuditContext(
        {
          id: 'request-1',
          ip: '203.0.113.8',
          headers: { 'user-agent': 'TrustPay/1.0' },
          socket: {},
        } as never,
        { actorId: 'user-1', idempotencyKey: 'raw-key' },
      ),
    ).toEqual({
      requestId: 'request-1',
      ipAddress: '203.0.113.8',
      userAgent: 'TrustPay/1.0',
      actorId: 'user-1',
      idempotencyKeyDigest: expect.stringMatching(/^[a-f0-9]{12}$/),
    });
  });

  it('uses the proxy-normalized request IP and never reparses forwarded-for', () => {
    const context = createRequestAuditContext({
      id: 7,
      ip: '198.51.100.4',
      headers: {
        'x-forwarded-for': 'forged.example, 198.51.100.4',
      },
      socket: { remoteAddress: '10.0.0.2' },
    } as never);

    expect(context.ipAddress).toBe('198.51.100.4');
    expect(context.requestId).toBe('7');
  });

  it('supplies safe values for missing request metadata', () => {
    const context = createRequestAuditContext({
      headers: {},
      socket: {},
    } as never);

    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.ipAddress).toBe('unknown');
    expect(context).not.toHaveProperty('userAgent');
  });

  it('bounds request IDs and user agents', () => {
    const context = createRequestAuditContext({
      id: 'r'.repeat(300),
      ip: '203.0.113.8',
      headers: { 'user-agent': 'a'.repeat(600) },
      socket: {},
    } as never);

    expect(context.requestId).toHaveLength(128);
    expect(context.userAgent).toHaveLength(256);
  });
});
