import type { Prisma } from '@prisma/client';

export type FinancialEmailEventType =
  | 'WALLET_CREDIT'
  | 'WALLET_DEBIT'
  | 'TRANSACTION_SUCCESS'
  | 'TRANSACTION_FAILED'
  | 'TRANSACTION_REVERSED';

export type FinancialTransactionStatus = 'SUCCESS' | 'FAILED' | 'REVERSED';

type EmailOutboxClient = Pick<Prisma.TransactionClient, 'emailOutbox'>;

export interface WalletMovementEmailInput {
  userId: string;
  ledgerEntryId: string;
  direction: 'CREDIT' | 'DEBIT';
}

export interface TransactionStatusEmailInput {
  userId: string;
  transactionId: string;
  status: FinancialTransactionStatus;
}

export interface FinancialEmailContext {
  amount: string;
  balanceAfter?: string;
  currency: 'NGN' | 'GHS';
  direction?: 'CREDIT' | 'DEBIT';
  reference: string;
  source?: string;
  status?: FinancialTransactionStatus | 'PENDING';
  transactionType?: string;
}

export async function enqueueWalletMovementEmail(
  tx: EmailOutboxClient,
  input: WalletMovementEmailInput,
): Promise<void> {
  const eventType: FinancialEmailEventType =
    input.direction === 'CREDIT' ? 'WALLET_CREDIT' : 'WALLET_DEBIT';

  await tx.emailOutbox.createMany({
    data: [
      {
        userId: input.userId,
        eventKey: `wallet:movement:${input.ledgerEntryId}`,
        eventType,
        orderId: input.ledgerEntryId,
      },
    ],
    skipDuplicates: true,
  });
}

export async function enqueueTransactionStatusEmail(
  tx: EmailOutboxClient,
  input: TransactionStatusEmailInput,
): Promise<void> {
  const eventType = `TRANSACTION_${input.status}`;

  await tx.emailOutbox.createMany({
    data: [
      {
        userId: input.userId,
        eventKey: `transaction:status:${input.transactionId}:${input.status}`,
        eventType,
        orderId: input.transactionId,
      },
    ],
    skipDuplicates: true,
  });
}

export function renderFinancialEmail(
  eventType: string,
  context: FinancialEmailContext,
  options: { subject?: string } = {},
): { subject: string; text: string; html: string } | null {
  const amount = `${context.currency} ${formatMoney(context.amount)}`;
  const balance = context.balanceAfter
    ? `${context.currency} ${formatMoney(context.balanceAfter)}`
    : undefined;
  const reference = context.reference;
  const escapedAmount = escapeHtml(amount);
  const escapedBalance = balance ? escapeHtml(balance) : undefined;
  const escapedReference = escapeHtml(reference);

  if (eventType === 'WALLET_CREDIT' || eventType === 'WALLET_DEBIT') {
    const credited = eventType === 'WALLET_CREDIT';
    const verb = credited ? 'credited' : 'debited';
    const preposition = credited ? 'to' : 'from';
    const subject =
      options.subject ??
      (credited
        ? 'Your TrustPay wallet was credited'
        : 'Your TrustPay wallet was debited');
    const kind = movementKind(context.source, credited ? 'CREDIT' : 'DEBIT');
    const balanceLine = balance
      ? ` Your balance after this movement is ${balance}.`
      : '';
    const text = `A ${kind} of ${amount} was ${verb} ${preposition} your TrustPay wallet.${balanceLine} Reference: ${reference}. If this was a wallet reservation, the external payment may still be processing. TrustPay will notify you when the transaction reaches a terminal state.`;
    const htmlBalance = escapedBalance
      ? `<p style="font-size:16px;line-height:1.6">Balance after this movement: <strong>${escapedBalance}</strong></p>`
      : '';
    const html = emailShell(
      subject,
      `<p style="font-size:16px;line-height:1.6">A ${escapeHtml(kind)} of <strong>${escapedAmount}</strong> was ${verb} ${preposition} your TrustPay wallet.</p>${htmlBalance}<p style="font-size:14px;line-height:1.6;color:#596273">Reference: ${escapedReference}</p><p style="font-size:14px;line-height:1.6;color:#596273">This is a wallet movement notice. External payment completion may still be processing.</p>`,
    );
    return { subject, text, html };
  }

  const status = statusForEventType(eventType);
  if (!status) return null;
  const transactionKind = transactionKindLabel(context.transactionType);
  const statusCopy =
    status === 'SUCCESS'
      ? 'was completed successfully'
      : status === 'REVERSED'
        ? 'was reversed'
        : 'could not be completed';
  const subject =
    options.subject ??
    (status === 'SUCCESS'
      ? `Your TrustPay ${transactionKind} is complete`
      : status === 'REVERSED'
        ? `Your TrustPay ${transactionKind} was reversed`
        : `Your TrustPay ${transactionKind} failed`);
  const text = `Your ${transactionKind} for ${amount} ${statusCopy}. Reference: ${reference}.${status === 'FAILED' ? ' If funds were reserved, TrustPay will notify you with the corresponding reversal.' : ''}`;
  const html = emailShell(
    subject,
    `<p style="font-size:16px;line-height:1.6">Your ${escapeHtml(transactionKind)} for <strong>${escapedAmount}</strong> ${statusCopy}.</p><p style="font-size:14px;line-height:1.6;color:#596273">Reference: ${escapedReference}</p>${
      status === 'FAILED'
        ? '<p style="font-size:14px;line-height:1.6;color:#596273">If funds were reserved, TrustPay will notify you with the corresponding reversal.</p>'
        : ''
    }`,
  );
  return { subject, text, html };
}

function statusForEventType(
  eventType: string,
): FinancialTransactionStatus | null {
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

function movementKind(
  source: string | undefined,
  direction: 'CREDIT' | 'DEBIT',
) {
  const normalized = source?.toUpperCase() ?? '';
  if (normalized.includes('REVERSAL') || normalized.includes('REFUND'))
    return direction === 'CREDIT' ? 'refund' : 'reversal';
  if (normalized.includes('TRANSFER'))
    return direction === 'CREDIT' ? 'transfer received' : 'transfer sent';
  if (normalized.includes('EXCHANGE')) return 'exchange wallet movement';
  if (normalized.includes('DEPOSIT') || normalized.endsWith('_DVA'))
    return 'deposit';
  if (normalized.includes('VTU')) return 'VTU purchase wallet movement';
  if (normalized.includes('WITHDRAW')) return 'withdrawal wallet movement';
  return direction === 'CREDIT' ? 'wallet credit' : 'wallet debit';
}

function transactionKindLabel(transactionType: string | undefined) {
  switch (transactionType) {
    case 'WITHDRAW':
      return 'withdrawal';
    case 'AIRTIME':
    case 'DATA':
    case 'CABLE':
    case 'ELECTRICITY':
      return 'VTU purchase';
    case 'INTERNAL_TRANSFER':
      return 'internal transfer';
    case 'EXCHANGE':
      return 'exchange';
    case 'FUND':
      return 'deposit';
    default:
      return 'transaction';
  }
}

function formatMoney(value: string): string {
  const normalized = value.trim();
  const [integerPart, fractionPart = ''] = normalized.split('.');
  const sign = integerPart.startsWith('-') ? '-' : '';
  const unsignedInteger = sign ? integerPart.slice(1) : integerPart;
  const grouped = unsignedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = `${fractionPart}00`.slice(0, 2);
  return `${sign}${grouped}.${fraction}`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function emailShell(subject: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f5f6fa;font-family:Arial,sans-serif;color:#17202f"><main style="max-width:520px;margin:32px auto;padding:32px;background:#fff;border-radius:16px"><p style="color:#e7472a;font-weight:700;font-size:24px">TrustPay</p><h1 style="font-size:26px">${escapeHtml(subject)}</h1>${content}<p style="font-size:14px;line-height:1.6;color:#596273">Never share your PIN or OTP to receive money.</p></main></body></html>`;
}
