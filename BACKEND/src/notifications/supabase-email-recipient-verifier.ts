import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  EmailRecipientVerification,
  EmailRecipientVerifier,
  normalizeRecipientEmail,
} from './email-recipient-verifier';

/**
 * Supabase Auth is the source of truth for email ownership. The local User
 * row intentionally has no confirmation column, so delivery must fail closed
 * when the provider cannot confirm both identity and address.
 */
@Injectable()
export class SupabaseEmailRecipientVerifier implements EmailRecipientVerifier {
  constructor(private readonly supabase: SupabaseService) {}

  async verify(input: {
    userId: string;
    email: string;
  }): Promise<EmailRecipientVerification> {
    try {
      const { data, error } = await this.supabase
        .getAdminClient()
        .auth.admin.getUserById(input.userId);
      const identity = data.user;
      if (error || !identity || identity.id !== input.userId) {
        return {
          verified: false,
          code: 'recipient_identity_unavailable',
          retryable: true,
        };
      }
      if (
        !identity.email_confirmed_at ||
        !identity.email ||
        normalizeRecipientEmail(identity.email) !==
          normalizeRecipientEmail(input.email)
      ) {
        return {
          verified: false,
          code: identity?.email_confirmed_at
            ? 'recipient_email_mismatch'
            : 'recipient_unconfirmed',
          retryable: true,
        };
      }

      return { verified: true };
    } catch {
      // Do not expose provider/configuration details or send when identity
      // verification is unavailable. The outbox worker will retry safely.
      return {
        verified: false,
        code: 'recipient_identity_unavailable',
        retryable: true,
      };
    }
  }
}
