import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class EmailOtpProvider {
  constructor(private readonly config: ConfigService) {}

  private client() {
    const url = this.config.get<string>('SUPABASE_URL');
    const key =
      this.config.get<string>('SUPABASE_PUBLISHABLE_KEY') ||
      this.config.get<string>('SUPABASE_ANON_KEY');
    if (!url || !key) throw this.unavailable();
    // Each call has isolated auth state. OTP verification must never replace
    // another request's session on the shared backend Supabase client.
    return createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async sendOtp(email: string): Promise<void> {
    try {
      const { error } = await this.client().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error) throw this.unavailable();
    } catch {
      throw this.unavailable();
    }
  }

  async verifyOtp(email: string, token: string): Promise<boolean> {
    try {
      const { data, error } = await this.client().auth.verifyOtp({
        email,
        token,
        type: 'email',
      });
      return (
        !error &&
        !!data.user?.email_confirmed_at &&
        data.user.email?.toLowerCase() === email
      );
    } catch {
      throw new ServiceUnavailableException(
        'Email verification unavailable. Please try again later.',
      );
    }
  }

  private unavailable() {
    return new ServiceUnavailableException(
      'Email code delivery unavailable. Please try again later.',
    );
  }
}
