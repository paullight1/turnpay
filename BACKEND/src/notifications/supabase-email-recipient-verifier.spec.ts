import { SupabaseEmailRecipientVerifier } from './supabase-email-recipient-verifier';

describe('SupabaseEmailRecipientVerifier', () => {
  function makeVerifier(response: unknown) {
    const getUserById = jest.fn().mockResolvedValue(response);
    const supabase = {
      getAdminClient: jest.fn(() => ({
        auth: { admin: { getUserById } },
      })),
    };
    return {
      verifier: new SupabaseEmailRecipientVerifier(supabase as never),
      getUserById,
    };
  }

  it('accepts a confirmed provider identity whose email matches the local row', async () => {
    const { verifier, getUserById } = makeVerifier({
      data: {
        user: {
          id: 'user-1',
          email: 'Ada@Example.com',
          email_confirmed_at: '2026-11-12T10:00:00.000Z',
        },
      },
      error: null,
    });

    await expect(
      verifier.verify({ userId: 'user-1', email: 'ada@example.com' }),
    ).resolves.toEqual({ verified: true });
    expect(getUserById).toHaveBeenCalledWith('user-1');
  });

  it.each([
    [
      'unconfirmed',
      {
        id: 'user-1',
        email: 'ada@example.com',
        email_confirmed_at: null,
      },
      null,
      'recipient_unconfirmed',
    ],
    [
      'mismatched',
      {
        id: 'user-1',
        email: 'other@example.com',
        email_confirmed_at: '2026-11-12T10:00:00.000Z',
      },
      null,
      'recipient_email_mismatch',
    ],
    [
      'provider error despite a returned user',
      {
        id: 'user-1',
        email: 'ada@example.com',
        email_confirmed_at: '2026-11-12T10:00:00.000Z',
      },
      new Error('provider error'),
      'recipient_identity_unavailable',
    ],
  ])(
    'rejects a %s provider identity',
    async (_label, user, error, expectedCode) => {
      const { verifier } = makeVerifier({
        data: { user },
        error,
      });

      await expect(
        verifier.verify({ userId: 'user-1', email: 'ada@example.com' }),
      ).resolves.toEqual({
        verified: false,
        code: expectedCode,
        retryable: true,
      });
    },
  );

  it('rejects an identity whose provider id does not match the outbox user', async () => {
    const { verifier } = makeVerifier({
      data: {
        user: {
          id: 'different-user',
          email: 'ada@example.com',
          email_confirmed_at: '2026-11-12T10:00:00.000Z',
        },
      },
      error: null,
    });

    await expect(
      verifier.verify({ userId: 'user-1', email: 'ada@example.com' }),
    ).resolves.toEqual({
      verified: false,
      code: 'recipient_identity_unavailable',
      retryable: true,
    });
  });
});
