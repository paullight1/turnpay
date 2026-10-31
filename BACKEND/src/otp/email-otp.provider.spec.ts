import { ServiceUnavailableException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { EmailOtpProvider } from './email-otp.provider';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('EmailOtpProvider', () => {
  const auth = { signInWithOtp: jest.fn(), verifyOtp: jest.fn() };
  const config = {
    get: (key: string) =>
      ({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
      })[key],
  };
  const provider = new EmailOtpProvider(config as never);
  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue({ auth });
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({
      data: {
        user: { email: 'ada@example.com', email_confirmed_at: '2026-10-31' },
      },
      error: null,
    });
  });
  it('sends email codes without creating unregistered identities or storing shared sessions', async () => {
    await provider.sendOtp('ada@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      options: { shouldCreateUser: false },
    });
    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'test-publishable',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
  });
  it('does not expose upstream errors or claim delivery on provider failure', async () => {
    auth.signInWithOtp.mockResolvedValue({
      error: { message: 'secret upstream error' },
    });
    await expect(provider.sendOtp('ada@example.com')).rejects.toEqual(
      new ServiceUnavailableException(
        'Email code delivery unavailable. Please try again later.',
      ),
    );
  });
  it('verifies the email token with the provider', async () => {
    await expect(provider.verifyOtp('ada@example.com', '123456')).resolves.toBe(
      true,
    );
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      token: '123456',
      type: 'email',
    });
  });
  it.each([
    { data: { user: null }, error: { message: 'expired' } },
    {
      data: {
        user: { email: 'other@example.com', email_confirmed_at: '2026-10-31' },
      },
      error: null,
    },
    { data: { user: { email: 'ada@example.com' } }, error: null },
  ])('rejects invalid or mismatched email ownership', async (response) => {
    auth.verifyOtp.mockResolvedValue(response);
    await expect(provider.verifyOtp('ada@example.com', '123456')).resolves.toBe(
      false,
    );
  });
});
