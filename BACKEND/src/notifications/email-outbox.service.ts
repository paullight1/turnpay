import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import nodemailer, { Transporter } from 'nodemailer';
import {
  FinancialEmailContext,
  FinancialEmailEventType,
  renderFinancialEmail,
} from './financial-notifications';
import { EMAIL_RECIPIENT_VERIFIER } from './email-recipient-verifier';
import type {
  EmailRecipientVerification,
  EmailRecipientVerifier,
} from './email-recipient-verifier';

export type EmailProvider = 'disabled' | 'resend' | 'smtp';

export interface SmtpEmailSettings {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  password: string;
}

export interface EmailOutboxSettings {
  provider: EmailProvider;
  enabled: boolean;
  from?: string;
  replyTo?: string;
  resendApiKey?: string;
  smtp?: SmtpEmailSettings;
  batchSize: number;
  leaseSeconds: number;
  retryBaseSeconds: number;
  maxAttempts?: number;
  notBefore?: Date;
  /** Explicit configuration error; delivery remains fail-closed until fixed. */
  configurationError?: 'invalid_not_before';
}

export interface EmailMessage {
  /** Stable outbox UUID used as the provider idempotency key when supported. */
  idempotencyKey: string;
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailTransportResult =
  | { status: 'SENT'; providerMessageId?: string }
  | { status: 'FAILED'; code: string; retryable?: boolean }
  | { status: 'UNKNOWN'; code: string };

export interface EmailTransport {
  send(message: EmailMessage): Promise<EmailTransportResult>;
}

export const EMAIL_OUTBOX_SETTINGS = Symbol('EMAIL_OUTBOX_SETTINGS');
export const TRANSACTIONAL_EMAIL_TRANSPORT = Symbol(
  'TRANSACTIONAL_EMAIL_TRANSPORT',
);

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const PROVIDER_TIMEOUT_MS = 15_000;
const RECIPIENT_VERIFY_TIMEOUT_MS = 10_000;
const MAX_SEND_CONCURRENCY = 5;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ClaimedEmailOutboxRow = {
  id: string;
  userId: string;
  eventKey: string;
  eventType: string;
  orderId: string;
  attemptCount: number;
  claimToken: string;
  user: { email: string };
};

export interface EmailDispatchSummary {
  enabled: boolean;
  claimed: number;
  sent: number;
  failed: number;
  exhausted: number;
  unknown: number;
}

type DispatchResult = 'SENT' | 'FAILED' | 'EXHAUSTED' | 'UNKNOWN';

export function readEmailOutboxSettings(
  config: Pick<ConfigService, 'get'>,
): EmailOutboxSettings {
  const providerValue = (config.get<string>('EMAIL_PROVIDER') ?? 'disabled')
    .trim()
    .toLowerCase();
  const provider: EmailProvider = ['disabled', 'resend', 'smtp'].includes(
    providerValue,
  )
    ? (providerValue as EmailProvider)
    : 'disabled';
  const from = config.get<string>('EMAIL_FROM')?.trim() || undefined;
  const replyTo = config.get<string>('EMAIL_REPLY_TO')?.trim() || undefined;
  const resendApiKey =
    config.get<string>('RESEND_API_KEY')?.trim() || undefined;
  const batchSize = boundedInteger(
    config.get<string>('EMAIL_OUTBOX_BATCH_SIZE'),
    25,
    1,
    100,
  );
  const leaseSeconds = boundedInteger(
    config.get<string>('EMAIL_OUTBOX_LEASE_SECONDS'),
    300,
    60,
    3600,
  );
  const retryBaseSeconds = boundedInteger(
    config.get<string>('EMAIL_OUTBOX_RETRY_BASE_SECONDS'),
    60,
    1,
    3600,
  );
  const maxAttempts = boundedInteger(
    config.get<string>('EMAIL_OUTBOX_MAX_ATTEMPTS'),
    5,
    1,
    20,
  );
  const notBeforeValue = config.get<string>('EMAIL_OUTBOX_NOT_BEFORE')?.trim();
  const notBefore = parseDate(notBeforeValue);
  const invalidNotBefore = Boolean(notBeforeValue && !notBefore);
  const configurationError = invalidNotBefore
    ? ('invalid_not_before' as const)
    : undefined;

  const smtpSecure = parseBoolean(config.get<string>('SMTP_SECURE'), true);
  const smtpRequireTls = parseBoolean(
    config.get<string>('SMTP_REQUIRE_TLS'),
    true,
  );
  const smtpHost = config.get<string>('SMTP_HOST')?.trim();
  const smtpUser = config.get<string>('SMTP_USER')?.trim();
  const smtpPassword = config.get<string>('SMTP_PASSWORD')?.trim();
  const smtpPort = parsePort(config.get<string>('SMTP_PORT'), 465);
  const smtp: SmtpEmailSettings | undefined =
    smtpHost && smtpUser && smtpPassword
      ? {
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          requireTls: smtpRequireTls,
          user: smtpUser,
          password: smtpPassword,
        }
      : undefined;

  const enabled =
    !invalidNotBefore &&
    ((provider === 'resend' && Boolean(from && resendApiKey)) ||
      (provider === 'smtp' && Boolean(from && smtp && smtp.requireTls)));

  return {
    provider,
    enabled,
    from,
    replyTo,
    resendApiKey,
    smtp,
    batchSize,
    leaseSeconds,
    retryBaseSeconds,
    maxAttempts,
    notBefore,
    configurationError,
  };
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function parsePort(value: unknown, fallback: number): number {
  return boundedInteger(value, fallback, 1, 65535);
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function renderAccountEmail(eventType: string): {
  subject: string;
  text: string;
  html: string;
} | null {
  switch (eventType) {
    case 'DEPOSIT_RECEIVED':
      return {
        subject: 'Your TrustPay deposit is confirmed',
        text: 'Your deposit has been credited to your TrustPay wallet. Open TrustPay to view your updated balance and transaction receipt. Never share your PIN or OTP to receive money.',
        html: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>TrustPay deposit confirmed</title></head><body style="margin:0;background:#f5f6fa;font-family:Arial,sans-serif;color:#17202f"><main style="max-width:520px;margin:32px auto;padding:32px;background:#fff;border-radius:16px"><p style="color:#e7472a;font-weight:700;font-size:24px">TrustPay</p><h1 style="font-size:26px">Your deposit is confirmed</h1><p style="font-size:16px;line-height:1.6">Your deposit has been credited to your TrustPay wallet.</p><p style="font-size:16px;line-height:1.6">Open TrustPay to view your updated balance and transaction receipt.</p><p style="font-size:14px;line-height:1.6;color:#596273">Never share your PIN or OTP to receive money.</p></main></body></html>',
      };
    case 'BVN_VERIFIED':
      return {
        subject: 'Your BVN is verified',
        text: 'Your BVN is verified. You can now request an NGN receiving account in TrustPay. Any saved request will continue automatically.',
        html: '<p>Your BVN is verified. You can now request an NGN receiving account in TrustPay. Any saved request will continue automatically.</p>',
      };
    case 'ACCOUNT_READY':
      return {
        subject: 'Your NGN receiving account is ready',
        text: 'Your NGN receiving account is ready. Open TrustPay to view your bank details.',
        html: '<p>Your NGN receiving account is ready. Open TrustPay to view your bank details.</p>',
      };
    default:
      return null;
  }
}

@Injectable()
export class TransactionalEmailOutboxService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_OUTBOX_SETTINGS)
    private readonly settings: EmailOutboxSettings,
    @Inject(TRANSACTIONAL_EMAIL_TRANSPORT)
    private readonly transport: EmailTransport,
    private readonly logger: PinoLogger,
    @Inject(EMAIL_RECIPIENT_VERIFIER)
    private readonly recipientVerifier: EmailRecipientVerifier,
  ) {
    if (this.settings.configurationError) {
      this.logger.error(
        { code: this.settings.configurationError },
        'Transactional email delivery disabled by invalid configuration',
      );
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processPendingEmails(): Promise<EmailDispatchSummary> {
    return this.dispatchPendingEmails();
  }

  async dispatchPendingEmails(now = new Date()): Promise<EmailDispatchSummary> {
    const from = this.settings.from;
    const summary: EmailDispatchSummary = {
      enabled: this.settings.enabled && Boolean(from),
      claimed: 0,
      sent: 0,
      failed: 0,
      exhausted: 0,
      unknown: 0,
    };
    // A disabled or incomplete configuration is intentionally a no-op. In
    // particular, it must not claim rows or consume retry attempts.
    if (!this.settings.enabled || !from) return summary;

    const claimed = await this.claimDueBatch(now);
    summary.claimed = claimed.length;
    const results = await mapWithConcurrency(
      claimed,
      MAX_SEND_CONCURRENCY,
      (row) => this.dispatchOne(row, now, from),
    );
    for (const result of results) {
      if (result === 'SENT') summary.sent += 1;
      if (result === 'FAILED') summary.failed += 1;
      if (result === 'EXHAUSTED') summary.exhausted += 1;
      if (result === 'UNKNOWN') summary.unknown += 1;
    }
    return summary;
  }

  private async claimDueBatch(now: Date): Promise<ClaimedEmailOutboxRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const staleBefore = new Date(
        now.getTime() - this.settings.leaseSeconds * 1000,
      );
      // A worker that lost its process/network lease is ambiguous. Mark it
      // terminally unknown so a later worker cannot silently duplicate it.
      await tx.emailOutbox.updateMany({
        where: {
          status: 'IN_FLIGHT',
          claimedAt: { lt: staleBefore },
        },
        data: {
          status: 'UNKNOWN',
          lastErrorCode: 'stale_lease',
          unknownAt: now,
          claimedAt: null,
          claimToken: null,
        },
      });

      const candidates = await tx.emailOutbox.findMany({
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          nextAttemptAt: { lte: now },
          ...(this.settings.notBefore
            ? { createdAt: { gte: this.settings.notBefore } }
            : {}),
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        // Keep the total claimed work bounded by both the configured batch
        // and the lease. Five 15-second provider calls per wave leave ample
        // room for finalization before the shortest supported lease expires.
        take: Math.min(
          this.settings.batchSize,
          Math.max(
            1,
            Math.floor(
              (this.settings.leaseSeconds * MAX_SEND_CONCURRENCY * 1000) /
                (PROVIDER_TIMEOUT_MS * 2),
            ),
          ),
        ),
        select: { id: true },
      });
      if (!candidates.length) return [];

      const claimToken = randomUUID();
      const claimedCount = await tx.emailOutbox.updateMany({
        where: {
          id: { in: candidates.map((candidate) => candidate.id) },
          status: { in: ['PENDING', 'FAILED'] },
          nextAttemptAt: { lte: now },
        },
        data: {
          status: 'IN_FLIGHT',
          claimToken,
          claimedAt: now,
          attemptCount: { increment: 1 },
        },
      });
      if (!claimedCount.count) return [];

      return (await tx.emailOutbox.findMany({
        where: { status: 'IN_FLIGHT', claimToken },
        select: {
          id: true,
          userId: true,
          eventKey: true,
          eventType: true,
          orderId: true,
          attemptCount: true,
          claimToken: true,
          user: { select: { email: true } },
        },
      })) as ClaimedEmailOutboxRow[];
    });
  }

  private async dispatchOne(
    row: ClaimedEmailOutboxRow,
    now: Date,
    from: string,
  ): Promise<DispatchResult> {
    if (!row.user.email?.trim()) {
      return (
        (await this.finalizeFailure(row, 'missing_recipient', now, false)) ??
        'UNKNOWN'
      );
    }

    const recipientVerification = await verifyRecipientWithDeadline(
      this.recipientVerifier,
      { userId: row.userId, email: row.user.email },
    );
    if (!recipientVerification.verified) {
      return (
        (await this.finalizeFailure(
          row,
          recipientVerification.code,
          now,
          recipientVerification.retryable,
        )) ?? 'UNKNOWN'
      );
    }

    let rendered: {
      content?: { subject: string; text: string; html: string };
      errorCode?: string;
      unknownCode?: string;
    };
    try {
      rendered = await this.renderEvent(row);
    } catch {
      return (
        (await this.finalizeFailure(row, 'render_error', now, true)) ??
        'UNKNOWN'
      );
    }
    if (rendered.unknownCode) {
      const finalized = await this.finalizeUnknown(
        row,
        rendered.unknownCode,
        now,
      );
      if (!finalized) return 'UNKNOWN';
      return 'UNKNOWN';
    }
    if (!rendered.content) {
      return (
        (await this.finalizeFailure(
          row,
          rendered.errorCode ?? 'unsupported_event_type',
          now,
          false,
        )) ?? 'UNKNOWN'
      );
    }
    let outcome: EmailTransportResult;
    try {
      // The network call is outside the claim transaction. Only a stable row
      // UUID is sent as the provider idempotency key; event identifiers are
      // never included in the message body.
      outcome = await this.transport.send({
        idempotencyKey: row.id,
        from,
        ...(this.settings.replyTo ? { replyTo: this.settings.replyTo } : {}),
        to: row.user.email,
        ...rendered.content,
      });
    } catch {
      outcome = { status: 'UNKNOWN', code: 'transport_error' };
    }

    if (outcome.status === 'SENT') {
      const finalized = await this.finalizeSent(
        row,
        outcome.providerMessageId,
        now,
      );
      if (!finalized) {
        this.logger.warn(
          { outboxId: row.id, eventType: row.eventType },
          'Transactional email lease was lost before finalization',
        );
        return 'UNKNOWN';
      }
      this.logger.info(
        { outboxId: row.id, eventType: row.eventType },
        'Transactional email sent',
      );
      return 'SENT';
    }
    const code = sanitizeErrorCode(outcome.code);
    if (outcome.status === 'FAILED') {
      const finalized = await this.finalizeFailure(
        row,
        code,
        now,
        outcome.retryable !== false,
      );
      if (!finalized) {
        this.logger.warn(
          { outboxId: row.id, eventType: row.eventType },
          'Transactional email failure lease was lost before finalization',
        );
        return 'UNKNOWN';
      }
      this.logger.warn(
        { outboxId: row.id, eventType: row.eventType, code, state: finalized },
        finalized === 'EXHAUSTED'
          ? 'Transactional email delivery exhausted'
          : 'Transactional email delivery failed; retry scheduled',
      );
      return finalized;
    }
    const finalized = await this.finalizeUnknown(row, code, now);
    if (!finalized) {
      this.logger.warn(
        { outboxId: row.id, eventType: row.eventType },
        'Transactional email unknown lease was lost before finalization',
      );
      return 'UNKNOWN';
    }
    this.logger.warn(
      { outboxId: row.id, eventType: row.eventType, code },
      'Transactional email delivery outcome is unknown',
    );
    return 'UNKNOWN';
  }

  private async renderEvent(row: ClaimedEmailOutboxRow): Promise<{
    content?: { subject: string; text: string; html: string };
    errorCode?: string;
    unknownCode?: string;
  }> {
    if (row.eventType === 'DEPOSIT_RECEIVED') {
      const deposit = await this.prisma.transaction.findUnique({
        where: { id: row.orderId },
        select: {
          userId: true,
          ledgerEntries: {
            where: { direction: 'CREDIT' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: {
              amount: true,
              balanceAfter: true,
              currency: true,
              direction: true,
              reference: true,
              source: true,
              wallet: { select: { userId: true } },
            },
          },
        },
      });
      if (!deposit) return { errorCode: 'transaction_not_found' };
      if (deposit.userId !== row.userId)
        return { errorCode: 'transaction_ownership_mismatch' };
      const ledger = deposit.ledgerEntries[0];
      if (!ledger) return { content: renderAccountEmail(row.eventType)! };
      if (ledger.wallet.userId !== row.userId)
        return { errorCode: 'ledger_ownership_mismatch' };
      const content = renderFinancialEmail(
        'WALLET_CREDIT',
        {
          amount: ledger.amount.toString(),
          balanceAfter: ledger.balanceAfter.toString(),
          currency: ledger.currency,
          direction: ledger.direction,
          reference: ledger.reference,
          source: ledger.source,
        },
        { subject: 'Your TrustPay deposit is confirmed' },
      );
      return content ? { content } : { errorCode: 'unsupported_event_type' };
    }

    const accountContent = renderAccountEmail(row.eventType);
    if (accountContent) return { content: accountContent };

    if (isFinancialEventType(row.eventType)) {
      if (isWalletMovementEventType(row.eventType)) {
        const ledger = await this.prisma.ledgerEntry.findUnique({
          where: { id: row.orderId },
          select: {
            id: true,
            amount: true,
            balanceAfter: true,
            currency: true,
            direction: true,
            reference: true,
            source: true,
            createdAt: true,
            wallet: { select: { userId: true } },
            transaction: {
              select: {
                userId: true,
                type: true,
                status: true,
              },
            },
          },
        });
        if (!ledger) return { errorCode: 'ledger_not_found' };
        if (ledger.wallet.userId !== row.userId)
          return { errorCode: 'ledger_ownership_mismatch' };

        const expectedDirection =
          row.eventType === 'WALLET_CREDIT' ? 'CREDIT' : 'DEBIT';
        if (ledger.direction !== expectedDirection)
          return { errorCode: 'ledger_direction_mismatch' };

        const context: FinancialEmailContext = {
          amount: ledger.amount.toString(),
          balanceAfter: ledger.balanceAfter.toString(),
          currency: ledger.currency,
          direction: ledger.direction,
          reference: ledger.reference,
          source: ledger.source,
          status: ledger.transaction.status,
          transactionType: ledger.transaction.type,
        };
        const content = renderFinancialEmail(row.eventType, context);
        return content ? { content } : { errorCode: 'unsupported_event_type' };
      }

      const transaction = await this.prisma.transaction.findUnique({
        where: { id: row.orderId },
        select: {
          id: true,
          userId: true,
          amount: true,
          currency: true,
          reference: true,
          status: true,
          type: true,
        },
      });
      if (!transaction) return { errorCode: 'transaction_not_found' };
      if (transaction.userId !== row.userId)
        return { errorCode: 'transaction_ownership_mismatch' };
      const expectedStatus = transactionStatusForEventType(row.eventType);
      if (!expectedStatus || transaction.status !== expectedStatus)
        return { unknownCode: 'transaction_status_changed' };

      const context: FinancialEmailContext = {
        amount: transaction.amount.toString(),
        currency: transaction.currency,
        reference: transaction.reference,
        status: transaction.status,
        transactionType: transaction.type,
      };
      const content = renderFinancialEmail(row.eventType, context);
      return content ? { content } : { errorCode: 'unsupported_event_type' };
    }

    return { errorCode: 'unsupported_event_type' };
  }

  private async finalizeSent(
    row: ClaimedEmailOutboxRow,
    providerMessageId: string | undefined,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.emailOutbox.updateMany({
      where: {
        id: row.id,
        status: 'IN_FLIGHT',
        claimToken: row.claimToken,
      },
      data: {
        status: 'SENT',
        providerMessageId: providerMessageId ?? null,
        sentAt: now,
        claimedAt: null,
        claimToken: null,
      },
    });
    return result.count === 1;
  }

  private async finalizeFailure(
    row: ClaimedEmailOutboxRow,
    code: string,
    now: Date,
    retryable: boolean,
  ): Promise<'FAILED' | 'EXHAUSTED' | null> {
    const maxAttempts = this.settings.maxAttempts || 5;
    const exhausted = !retryable || row.attemptCount >= maxAttempts;
    const retrySeconds = Math.min(
      3600,
      this.settings.retryBaseSeconds *
        2 ** Math.min(Math.max(row.attemptCount - 1, 0), 6),
    );
    const result = await this.prisma.emailOutbox.updateMany({
      where: {
        id: row.id,
        status: 'IN_FLIGHT',
        claimToken: row.claimToken,
      },
      data: {
        status: exhausted ? 'EXHAUSTED' : 'FAILED',
        lastErrorCode: sanitizeErrorCode(code),
        nextAttemptAt: exhausted
          ? now
          : new Date(now.getTime() + retrySeconds * 1000),
        ...(exhausted ? { exhaustedAt: now } : {}),
        claimedAt: null,
        claimToken: null,
      },
    });
    return result.count === 1 ? (exhausted ? 'EXHAUSTED' : 'FAILED') : null;
  }

  private async finalizeUnknown(
    row: ClaimedEmailOutboxRow,
    code: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.emailOutbox.updateMany({
      where: {
        id: row.id,
        status: 'IN_FLIGHT',
        claimToken: row.claimToken,
      },
      data: {
        status: 'UNKNOWN',
        lastErrorCode: sanitizeErrorCode(code),
        unknownAt: now,
        claimedAt: null,
        claimToken: null,
      },
    });
    return result.count === 1;
  }
}

export class ResendEmailTransport implements EmailTransport {
  private readonly fetcher: FetchLike;

  constructor(
    private readonly apiKey: string,
    fetcher?: FetchLike,
  ) {
    this.fetcher = fetcher ?? ((...args) => globalThis.fetch(...args));
  }

  async send(message: EmailMessage): Promise<EmailTransportResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await this.fetcher(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          from: message.from,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) {
        if (response.status >= 500 && response.status < 600) {
          // A provider 5xx can be returned after accepting the request. A
          // later retry may also fall outside Resend's 24-hour idempotency
          // window, so keep this outcome terminally ambiguous.
          return { status: 'UNKNOWN', code: 'http_5xx' };
        }
        return {
          status: 'FAILED',
          code: `http_${response.status}`,
          retryable: response.status === 429 || response.status >= 500,
        };
      }
      let providerMessageId: string | undefined;
      try {
        const body = (await response.json()) as { id?: unknown };
        if (typeof body.id === 'string' && body.id.length <= 128)
          providerMessageId = body.id;
      } catch {
        // A successful HTTP response is accepted even if its optional body is
        // unavailable; provider message IDs are not used for deduplication.
      }
      return { status: 'SENT', providerMessageId };
    } catch {
      // The request may have been accepted before the connection failed. Do
      // not retry automatically because the provider's idempotency window may
      // have elapsed by the time a later worker runs.
      return { status: 'UNKNOWN', code: 'network_error' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class SmtpEmailTransport implements EmailTransport {
  private readonly transporter: Transporter;

  constructor(settings: SmtpEmailSettings) {
    if (!settings.requireTls) {
      throw new Error('SMTP TLS is required');
    }
    this.transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: settings.requireTls,
      connectionTimeout: PROVIDER_TIMEOUT_MS,
      greetingTimeout: PROVIDER_TIMEOUT_MS,
      socketTimeout: PROVIDER_TIMEOUT_MS,
      auth: {
        user: settings.user,
        pass: settings.password,
      },
      tls: {
        minVersion: 'TLSv1.2',
      },
    });
  }

  async send(message: EmailMessage): Promise<EmailTransportResult> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const sendPromise = this.transporter.sendMail({
        from: message.from,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      const deadlinePromise = new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error('smtp_deadline')),
          PROVIDER_TIMEOUT_MS,
        );
      });
      const accepted = await Promise.race([sendPromise, deadlinePromise]);
      const rejectionRetryable = this.confirmedRejectionRetryable(accepted);
      if (rejectionRetryable !== null) {
        return {
          status: 'FAILED',
          code: 'smtp_rejected',
          retryable: rejectionRetryable,
        };
      }
      return {
        status: 'SENT',
        providerMessageId:
          typeof accepted.messageId === 'string'
            ? accepted.messageId
            : undefined,
      };
    } catch (error) {
      const retryable = this.confirmedRejectionRetryable(error);
      if (retryable !== null) {
        return { status: 'FAILED', code: 'smtp_rejected', retryable };
      }
      return { status: 'UNKNOWN', code: 'smtp_ambiguous' };
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  private confirmedRejectionRetryable(error: unknown): boolean | null {
    if (!error || typeof error !== 'object') return null;
    const value = error as {
      rejected?: unknown[];
      accepted?: unknown[];
      responseCode?: unknown;
      code?: unknown;
    };
    const rejected =
      Array.isArray(value.rejected) &&
      value.rejected.length > 0 &&
      (!Array.isArray(value.accepted) || value.accepted.length === 0);
    const responseCode =
      typeof value.responseCode === 'number' ? value.responseCode : undefined;
    if (value.code === 'EAUTH' || (responseCode && responseCode >= 500))
      return false;
    if (rejected && responseCode && responseCode >= 400 && responseCode < 500)
      return true;
    if (rejected) return false;
    if (responseCode !== undefined && responseCode >= 400)
      return responseCode < 500;
    return null;
  }
}

export class DisabledEmailTransport implements EmailTransport {
  send(): Promise<EmailTransportResult> {
    return Promise.resolve({ status: 'UNKNOWN', code: 'disabled' });
  }
}

export function sanitizeErrorCode(code: string): string {
  return /^[A-Za-z0-9:_-]{1,64}$/.test(code) ? code : 'transport_error';
}

function isFinancialEventType(
  eventType: string,
): eventType is FinancialEmailEventType {
  return (
    eventType === 'WALLET_CREDIT' ||
    eventType === 'WALLET_DEBIT' ||
    eventType === 'TRANSACTION_SUCCESS' ||
    eventType === 'TRANSACTION_FAILED' ||
    eventType === 'TRANSACTION_REVERSED'
  );
}

function isWalletMovementEventType(
  eventType: FinancialEmailEventType,
): eventType is 'WALLET_CREDIT' | 'WALLET_DEBIT' {
  return eventType === 'WALLET_CREDIT' || eventType === 'WALLET_DEBIT';
}

function transactionStatusForEventType(
  eventType: FinancialEmailEventType,
): 'SUCCESS' | 'FAILED' | 'REVERSED' | null {
  switch (eventType) {
    case 'TRANSACTION_SUCCESS':
      return 'SUCCESS';
    case 'TRANSACTION_FAILED':
      return 'FAILED';
    case 'TRANSACTION_REVERSED':
      return 'REVERSED';
    default:
      return null;
  }
}

async function verifyRecipientWithDeadline(
  verifier: EmailRecipientVerifier,
  input: { userId: string; email: string },
): Promise<EmailRecipientVerification> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const verification = verifier.verify(input);
    const deadlinePromise = new Promise<never>((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error('recipient_verification_deadline')),
        RECIPIENT_VERIFY_TIMEOUT_MS,
      );
    });
    return await Promise.race([verification, deadlinePromise]);
  } catch {
    return {
      verified: false,
      code: 'recipient_identity_unavailable',
      retryable: true,
    };
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}
