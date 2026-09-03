export type TransferCurrency = "NGN" | "GHS";

export type RecipientIdentifier =
  | { recipientEmail: string }
  | { recipientPhone: string };

export type InternalTransferDraft = {
  recipient: string;
  amount: string;
  currency: TransferCurrency;
  note: string;
};

export type ValidatedInternalTransfer = {
  recipient: RecipientIdentifier;
  amount: string;
  currency: TransferCurrency;
  note?: string;
};

export type TransferValidationErrors = Partial<
  Record<"recipient" | "amount" | "note", string>
>;

export type EligibleRecipientPreview = {
  found: true;
  displayName: string;
  maskedIdentifier: string;
  avatarInitials: string;
};

export type RecipientPreview = EligibleRecipientPreview | { found: false };

export type InternalTransferReceipt = {
  reference: string;
  status: "SUCCESS";
  amount: string;
  currency: TransferCurrency;
  senderTransactionReference: string;
  senderBalanceAfter: string;
  recipient: {
    maskedIdentifier: string;
    avatarInitials: string;
  };
  createdAt: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[1-9]\d{1,14}$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

function codePointLength(value: string) {
  return Array.from(value).length;
}

export function parseRecipient(value: string): RecipientIdentifier | null {
  const normalized = value.trim();
  if (EMAIL_PATTERN.test(normalized)) {
    return { recipientEmail: normalized.toLowerCase() };
  }
  if (PHONE_PATTERN.test(normalized)) {
    return { recipientPhone: normalized };
  }
  return null;
}

export function normalizeMoneyAmount(value: string): string | null {
  const normalized = value.trim();
  if (!MONEY_PATTERN.test(normalized)) return null;

  const [integerPart, decimalPart = ""] = normalized.split(".");
  const canonicalInteger = integerPart.replace(/^0+(?=\d)/, "");
  if (!/[1-9]/.test(`${canonicalInteger}${decimalPart}`)) return null;

  return decimalPart ? `${canonicalInteger}.${decimalPart}` : canonicalInteger;
}

export function validateInternalTransfer(
  draft: InternalTransferDraft,
): { value?: ValidatedInternalTransfer; errors: TransferValidationErrors } {
  const errors: TransferValidationErrors = {};
  const recipient = parseRecipient(draft.recipient);
  const amount = normalizeMoneyAmount(draft.amount);
  const note = draft.note.trim();

  if (!recipient) {
    errors.recipient = "Enter a valid email address or international phone number.";
  }
  if (!amount) {
    errors.amount = "Enter a positive amount with no more than 2 decimal places.";
  }
  if (codePointLength(note) > 120) {
    errors.note = "Keep the note to 120 characters or fewer.";
  }

  if (!recipient || !amount || Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors,
    value: {
      recipient,
      amount,
      currency: draft.currency,
      ...(note ? { note } : {}),
    },
  };
}

export function transferAttemptFingerprint(value: ValidatedInternalTransfer) {
  return JSON.stringify(value);
}

export function formatTransferMoney(amount: string, currency: TransferCurrency) {
  const [integerPart, decimalPart = ""] = amount.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${grouped}.${decimalPart.padEnd(2, "0").slice(0, 2)}`;
}

export function transferFinancialRows(amount: string, currency: TransferCurrency) {
  const formattedAmount = formatTransferMoney(amount, currency);
  return [
    { label: "Amount", value: formattedAmount },
    { label: "Fee", value: `${currency} 0.00` },
    { label: "Total debit", value: formattedAmount },
  ] as const;
}

export function countTransferNoteCodePoints(value: string) {
  return codePointLength(value);
}
