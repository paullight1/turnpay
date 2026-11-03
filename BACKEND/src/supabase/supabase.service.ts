import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  SupabaseClient,
  User as SupabaseUser,
} from '@supabase/supabase-js';
import { WalletCurrency } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type TrustPaySupabaseClient = SupabaseClient<any, any, 'public', any, any>;
type SupabaseSignOutScope = 'local' | 'global' | 'others';
const PASSWORD_UPDATE_TIMEOUT_MS = 10_000;

type RecoveryIdentityCandidate = {
  id: string;
  email: string;
  phone: string;
  fullName: string | null;
  role: 'USER' | 'ADMIN';
};

@Injectable()
export class SupabaseService {
  public client: TrustPaySupabaseClient;
  public authClient: TrustPaySupabaseClient;
  public recoveryClient: TrustPaySupabaseClient;
  public adminClient?: TrustPaySupabaseClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_PUBLISHABLE_KEY') ||
      this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');
    const supabaseServiceKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    this.authClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Recovery links are opened from an email client and may land in a
    // different browser or device than the one that requested them. Keep
    // this flow explicit so server-generated links never require a browser
    // local PKCE verifier.
    this.recoveryClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        flowType: 'implicit',
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.client = this.authClient;

    if (supabaseServiceKey) {
      this.adminClient = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    }

    this.logger.info({}, 'Supabase client initialized');
  }

  async verifyToken(accessToken: string) {
    const { data, error } = await this.authClient.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    return data.user;
  }

  /**
   * Returns the session_id from an access token after Supabase has verified it.
   * getClaims() performs signature/expiry validation and falls back to the
   * Auth server for projects using symmetric JWT signing.
   */
  async getVerifiedProviderSessionId(accessToken: string) {
    this.assertJwtEnvelopeIsWellFormed(accessToken);
    try {
      const { data, error } = await this.authClient.auth.getClaims(accessToken);
      const sessionId = data?.claims?.session_id;

      if (error || typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new UnauthorizedException(
          'Session expired. Please sign in again.',
        );
      }

      return sessionId;
    } catch (error) {
      // auth-js throws ordinary Errors for these JWT claim failures instead
      // of returning AuthError. Preserve 401 so clients can refresh the token.
      // Unexpected transport/runtime failures must not sign the customer out.
      if (
        error instanceof Error &&
        (error.message === 'JWT has expired' ||
          error.message === 'Missing exp claim' ||
          error.message === 'Invalid alg claim')
      ) {
        throw new UnauthorizedException(
          'Session expired. Please sign in again.',
        );
      }
      throw error;
    }
  }

  private assertJwtEnvelopeIsWellFormed(token: string) {
    // Reject malformed input before SDK JSON/property access can throw a 500.
    // Decoded claims never authenticate anyone; the SDK must still verify them.
    try {
      const parts = token.split('.');
      if (
        parts.length !== 3 ||
        parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
      ) {
        throw new Error('Invalid JWT structure');
      }
      const parseObject = (part: string): Record<string, unknown> => {
        const parsed: unknown = JSON.parse(
          Buffer.from(part, 'base64url').toString('utf8'),
        );
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Invalid JWT object');
        }
        return parsed as Record<string, unknown>;
      };
      const header = parseObject(parts[0]);
      const claims = parseObject(parts[1]);
      if (
        typeof header.alg !== 'string' ||
        !header.alg ||
        typeof claims.exp !== 'number' ||
        !Number.isFinite(claims.exp)
      ) {
        throw new Error('Invalid JWT claims');
      }
    } catch {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
  }

  /**
   * Supabase's signOut() uses the client's stored session. The backend does
   * not keep mutable SDK sessions, so call the explicit-token admin API
   * method, which sends the provider JWT to /auth/v1/logout.
   */
  async revokeProviderSession(
    accessToken: string,
    scope: SupabaseSignOutScope = 'local',
  ) {
    const { error } = await this.authClient.auth.admin.signOut(
      accessToken,
      scope,
    );

    if (error) {
      throw new Error('Unable to revoke the Supabase session');
    }
  }

  /**
   * Update a signed-in user's password with the access token explicitly
   * supplied by the caller. Calling auth.updateUser() on a header-only client
   * is rejected by auth-js because it has no stored session; this direct Auth
   * API request preserves the same user-token authorization without mutating a
   * shared SDK client's session state.
   */
  async updatePasswordWithAccessToken(accessToken: string, password: string) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_PUBLISHABLE_KEY') ||
      this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      redirect: 'error',
      signal: AbortSignal.timeout(PASSWORD_UPDATE_TIMEOUT_MS),
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      throw new Error('Unable to update the Supabase password');
    }
  }

  createUserScopedClient(accessToken: string) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_PUBLISHABLE_KEY') ||
      this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');

    return createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });
  }

  getAdminClient() {
    if (!this.adminClient) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is required for admin auth operations',
      );
    }

    return this.adminClient;
  }

  async ensureRecoveryIdentity(candidate: RecoveryIdentityCandidate) {
    const admin = this.getAdminClient().auth.admin;
    const { data: legacyIdentity, error: lookupError } =
      await admin.getUserById(candidate.id);

    if (legacyIdentity.user) {
      return;
    }

    if (
      lookupError &&
      lookupError.code !== 'user_not_found' &&
      lookupError.status !== 404
    ) {
      throw new Error('Unable to verify password recovery identity');
    }

    const temporaryPassword = `${randomBytes(32).toString('base64url')}Aa1!`;
    const { error: createError } = await admin.createUser({
      email: candidate.email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { role: candidate.role },
      user_metadata: {
        phone: candidate.phone,
        ...(candidate.fullName ? { full_name: candidate.fullName } : {}),
      },
    });

    if (
      createError &&
      createError.code !== 'user_already_exists' &&
      createError.code !== 'email_exists'
    ) {
      throw new Error('Unable to repair password recovery identity');
    }
  }

  async createSignedUploadUrl(bucket: string, objectKey: string) {
    const { data, error } = await this.getAdminClient()
      .storage.from(bucket)
      .createSignedUploadUrl(objectKey, { upsert: false });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async createSignedReadUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds: number,
  ) {
    const { data, error } = await this.getAdminClient()
      .storage.from(bucket)
      .createSignedUrl(objectKey, expiresInSeconds);

    if (error) {
      throw new Error(error.message);
    }

    return data.signedUrl;
  }

  async setAuthAppRole(userId: string, role: 'USER' | 'ADMIN') {
    const { error } = await this.getAdminClient().auth.admin.updateUserById(
      userId,
      {
        app_metadata: { role },
      },
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  async syncUser(supabaseUser: SupabaseUser) {
    const email = supabaseUser.email;

    if (!email) {
      throw new Error('Supabase user is missing an email address');
    }

    const phone = this.resolvePhone(supabaseUser);
    const fullName = this.resolveFullName(supabaseUser);
    const currencies: WalletCurrency[] = ['NGN', 'GHS'];

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: {
          OR: [{ id: supabaseUser.id }, { email }],
        },
      });

      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              email,
              phone:
                existing.phone.length === 0 ||
                existing.phone.startsWith('supabase:')
                  ? phone
                  : existing.phone,
              fullName: existing.fullName || fullName,
            },
          })
        : await tx.user.create({
            data: {
              id: supabaseUser.id,
              email,
              phone,
              fullName,
              password: '',
              role: 'USER',
              kycStatus: 'PENDING',
            },
          });

      await Promise.all(
        currencies.map((currency) =>
          tx.wallet.upsert({
            where: {
              userId_currency: {
                userId: user.id,
                currency,
              },
            },
            update: {},
            create: {
              userId: user.id,
              currency,
              balance: 0,
            },
          }),
        ),
      );

      return user;
    });
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  private resolvePhone(supabaseUser: SupabaseUser) {
    const metadata = supabaseUser.user_metadata as
      | Record<string, unknown>
      | undefined;
    const metadataPhone = metadata?.phone;
    const phone =
      typeof metadataPhone === 'string' && metadataPhone.trim().length > 0
        ? metadataPhone.trim()
        : supabaseUser.phone?.trim();

    return phone || `supabase:${supabaseUser.id}`;
  }

  private resolveFullName(supabaseUser: SupabaseUser) {
    const metadata = (supabaseUser.user_metadata ?? {}) as Record<
      string,
      unknown
    >;
    const fullName = metadata.fullName || metadata.full_name || metadata.name;

    return typeof fullName === 'string' && fullName.trim().length > 0
      ? fullName.trim()
      : undefined;
  }
}
