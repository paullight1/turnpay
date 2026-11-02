import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { NinjaProvider } from './ninja.provider';

describe('NinjaProvider', () => {
  const input = {
    userId: 'u',
    documentId: 'document-1',
    type: 'NIN' as const,
    country: 'NG' as const,
    identifier: '77777777777',
    identifierMasked: '*******7777',
    consentAccepted: true as const,
    validation: {
      firstName: 'James',
      lastName: 'Bond',
      dateOfBirth: '1975-01-01',
    },
  };
  const accepted = {
    found: true,
    verified: true,
    recommendation: 'accept',
    score: 1,
    fields: ['first_name', 'last_name', 'date_of_birth'].map((field) => ({
      field,
      score: 1,
      match: 'exact',
      provided: 'SENSITIVE',
    })),
  };
  function setup(
    config: Record<string, unknown> = {
      NINJA_NIN_ENABLED: true,
      NINJA_SECRET_KEY: 'sk_sandbox_test',
      NINJA_BASE_URL: 'https://api.sandbox.ninja.boucloud.io',
    },
  ) {
    const http = { post: jest.fn().mockReturnValue(of({ data: accepted })) };
    return {
      http,
      provider: new NinjaProvider(http as any, new ConfigService(config)),
    };
  }
  it('sends strict match mode from the backend and persists only safe evidence', async () => {
    const { http, provider } = setup();
    const result = await provider.verifyIdentity(input);
    expect(result.status).toBe('VERIFIED');
    expect(http.post).toHaveBeenCalledWith(
      'https://api.sandbox.ninja.boucloud.io/api/identity/identify',
      expect.objectContaining({
        mode: 'verify',
        idType: 'nin',
        reference: 'document-1',
        dateOfBirth: '1975-01-01',
        rules: expect.objectContaining({ accept_score: 1 }),
      }),
      expect.objectContaining({ maxRedirects: 0 }),
    );
    expect(JSON.stringify(result)).not.toContain('SENSITIVE');
    expect(JSON.stringify(result)).not.toContain(input.identifier);
  });
  it.each([
    { ...accepted, fields: accepted.fields.slice(0, 2) },
    {
      ...accepted,
      fields: accepted.fields.map((field) => ({ ...field, match: 'mismatch' })),
    },
    { ...accepted, score: '1' },
    { ...accepted, verified: 'true' },
    {},
  ])(
    'never approves incomplete or malformed provider success',
    async (body) => {
      const { provider, http } = setup();
      http.post.mockReturnValue(of({ data: body as any }));
      expect((await provider.verifyIdentity(input)).status).not.toBe(
        'VERIFIED',
      );
    },
  );
  it('requires explicit enablement and an allowlisted host', async () => {
    for (const config of [
      {},
      {
        NINJA_NIN_ENABLED: true,
        NINJA_SECRET_KEY: 'test',
        NINJA_BASE_URL: 'https://untrusted.example',
      },
    ]) {
      const { provider, http } = setup(config);
      await expect(provider.verifyIdentity(input)).rejects.toThrow(
        'NIN verification is currently unavailable',
      );
      expect(http.post).not.toHaveBeenCalled();
    }
  });
  it('does not expose provider payloads or keys when the network fails', async () => {
    const { provider, http } = setup();
    http.post.mockReturnValue(throwError(() => new Error('secret payload')));
    await expect(provider.verifyIdentity(input)).rejects.toThrow(
      'NIN verification is temporarily unavailable',
    );
  });
});
