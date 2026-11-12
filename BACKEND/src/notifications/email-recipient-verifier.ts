export type EmailRecipientVerification =
  | { verified: true }
  | {
      verified: false;
      code:
        | 'recipient_unconfirmed'
        | 'recipient_email_mismatch'
        | 'recipient_identity_unavailable';
      retryable: true;
    };

export interface EmailRecipientVerifier {
  verify(input: {
    userId: string;
    email: string;
  }): Promise<EmailRecipientVerification>;
}

export const EMAIL_RECIPIENT_VERIFIER = Symbol('EMAIL_RECIPIENT_VERIFIER');

export function normalizeRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
}
