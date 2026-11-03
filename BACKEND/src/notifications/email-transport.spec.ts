import {
  readEmailOutboxSettings,
  renderAccountEmail,
  ResendEmailTransport,
} from './email-outbox.service';

describe('transactional email configuration and transport', () => {
  it('keeps delivery disabled when provider credentials are absent', () => {
    const values: Record<string, string | undefined> = {
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'TrustPay <support@trustpayhq.com>',
      EMAIL_REPLY_TO: 'support@auth.trustpayhq.com',
    };
    const settings = readEmailOutboxSettings({
      get: <T>(key: string) => values[key] as T,
    });

    expect(settings).toMatchObject({
      provider: 'resend',
      enabled: false,
      replyTo: 'support@auth.trustpayhq.com',
    });
  });

  it('rejects SMTP configuration that weakens TLS', () => {
    const values: Record<string, string | undefined> = {
      EMAIL_PROVIDER: 'smtp',
      EMAIL_FROM: 'TrustPay <support@trustpayhq.com>',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_REQUIRE_TLS: 'false',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'password',
    };
    const settings = readEmailOutboxSettings({
      get: <T>(key: string) => values[key] as T,
    });

    expect(settings.enabled).toBe(false);
  });

  it('sends Resend requests to the fixed endpoint with the stable row key', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-message-1' }),
    });
    const transport = new ResendEmailTransport('resend-secret', fetcher);

    const result = await transport.send({
      idempotencyKey: 'outbox-row-1',
      from: 'TrustPay <support@trustpayhq.com>',
      replyTo: 'support@auth.trustpayhq.com',
      to: 'ada@example.com',
      subject: 'Your BVN is verified',
      text: 'Your BVN is verified. You can now request an NGN receiving account in TrustPay.',
      html: '<p>Your BVN is verified. You can now request an NGN receiving account in TrustPay.</p>',
    });

    expect(result).toEqual({
      status: 'SENT',
      providerMessageId: 'resend-message-1',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer resend-secret',
          'Idempotency-Key': 'outbox-row-1',
        }),
      }),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      reply_to: 'support@auth.trustpayhq.com',
    });
  });

  it('classifies explicit provider rejections as retryable only when the status is transient', async () => {
    const transientFetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 429 });
    const permanentFetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 401 });
    const message = {
      idempotencyKey: 'outbox-row-1',
      from: 'TrustPay <support@trustpayhq.com>',
      to: 'ada@example.com',
      subject: 'Identity verification complete',
      text: 'Your identity verification is complete.',
      html: '<p>Your identity verification is complete.</p>',
    };

    await expect(
      new ResendEmailTransport('secret', transientFetch).send(message),
    ).resolves.toEqual({ status: 'FAILED', code: 'http_429', retryable: true });
    await expect(
      new ResendEmailTransport('secret', permanentFetch).send(message),
    ).resolves.toEqual({
      status: 'FAILED',
      code: 'http_401',
      retryable: false,
    });
  });

  it('treats a Resend 5xx response as ambiguous instead of retrying after the idempotency window', async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(
      new ResendEmailTransport('secret', fetcher).send({
        idempotencyKey: 'outbox-row-1',
        from: 'TrustPay <support@trustpayhq.com>',
        to: 'ada@example.com',
        subject: 'Your BVN is verified',
        text: 'Your BVN is verified.',
        html: '<p>Your BVN is verified.</p>',
      }),
    ).resolves.toEqual({ status: 'UNKNOWN', code: 'http_5xx' });
  });

  it('renders only static status content without event identifiers', () => {
    const email = renderAccountEmail('ACCOUNT_READY');
    expect(email).toEqual({
      subject: 'Your NGN receiving account is ready',
      text: 'Your NGN receiving account is ready. Open TrustPay to view your bank details.',
      html: '<p>Your NGN receiving account is ready. Open TrustPay to view your bank details.</p>',
    });
    expect(JSON.stringify(email)).not.toMatch(/account-|user-|token|secret/i);
  });
});
