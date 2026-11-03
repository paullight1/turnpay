import nodemailer from 'nodemailer';
import { SmtpEmailSettings, SmtpEmailTransport } from './email-outbox.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

const createTransport = nodemailer.createTransport as jest.Mock;

const settings: SmtpEmailSettings = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  requireTls: true,
  user: 'smtp-user',
  password: 'smtp-password',
};

const message = {
  idempotencyKey: 'outbox-row-1',
  from: 'TrustPay <support@trustpayhq.com>',
  replyTo: 'support@auth.trustpayhq.com',
  to: 'ada@example.com',
  subject: 'Your BVN is verified',
  text: 'Your BVN is verified.',
  html: '<p>Your BVN is verified.</p>',
};

describe('SmtpEmailTransport', () => {
  beforeEach(() => {
    jest.useRealTimers();
    createTransport.mockReset();
  });

  it('returns SENT only after Nodemailer accepts the message', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<smtp-1>' });
    createTransport.mockReturnValue({ sendMail });

    const transport = new SmtpEmailTransport(settings);
    await expect(transport.send(message)).resolves.toEqual({
      status: 'SENT',
      providerMessageId: '<smtp-1>',
    });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: false,
        requireTLS: true,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000,
        auth: { user: 'smtp-user', pass: 'smtp-password' },
        tls: { minVersion: 'TLSv1.2' },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: message.from,
        replyTo: message.replyTo,
        to: message.to,
        subject: message.subject,
      }),
    );
  });

  it('classifies SMTP authentication rejection as a permanent failure', async () => {
    const sendMail = jest.fn().mockRejectedValue({ code: 'EAUTH' });
    createTransport.mockReturnValue({ sendMail });

    await expect(
      new SmtpEmailTransport(settings).send(message),
    ).resolves.toEqual({
      status: 'FAILED',
      code: 'smtp_rejected',
      retryable: false,
    });
  });

  it('keeps a post-DATA network loss ambiguous', async () => {
    const sendMail = jest.fn().mockRejectedValue({
      code: 'ECONNRESET',
      accepted: ['ada@example.com'],
    });
    createTransport.mockReturnValue({ sendMail });

    await expect(
      new SmtpEmailTransport(settings).send(message),
    ).resolves.toEqual({ status: 'UNKNOWN', code: 'smtp_ambiguous' });
  });

  it('returns UNKNOWN when the overall SMTP deadline expires', async () => {
    jest.useFakeTimers();
    const sendMail = jest.fn().mockReturnValue(new Promise(() => undefined));
    createTransport.mockReturnValue({ sendMail });

    const result = new SmtpEmailTransport(settings).send(message);
    await jest.advanceTimersByTimeAsync(15000);
    await expect(result).resolves.toEqual({
      status: 'UNKNOWN',
      code: 'smtp_ambiguous',
    });
  });

  it('does not treat an all-rejected SMTP response as accepted', async () => {
    const sendMail = jest.fn().mockResolvedValue({
      messageId: '<smtp-rejected>',
      rejected: ['ada@example.com'],
      accepted: [],
    });
    createTransport.mockReturnValue({ sendMail });

    await expect(
      new SmtpEmailTransport(settings).send(message),
    ).resolves.toEqual({
      status: 'FAILED',
      code: 'smtp_rejected',
      retryable: false,
    });
  });
});
