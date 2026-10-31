import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { SupabaseService } from '../../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { User as SupabaseUser } from '@supabase/supabase-js';

type RequestWithUser = {
  headers: {
    authorization?: string;
  };
  user?: {
    userId: string;
    email: string;
    role: string;
    canAccessAdmin: boolean;
  };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const accessToken = authHeader.slice('Bearer '.length).trim();
    if (!accessToken) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let userId: string;
    let role: string;
    let verifiedIdentity: SupabaseUser | undefined;
    let providerSessionId: string | undefined;

    try {
      const [supabaseUser, sessionId] = await Promise.all([
        this.supabaseService.verifyToken(accessToken),
        this.supabaseService.getVerifiedProviderSessionId(accessToken),
      ]);
      userId = supabaseUser.id;
      role = 'USER';
      verifiedIdentity = supabaseUser;
      providerSessionId = sessionId;
    } catch (supabaseError) {
      if (this.canUseLocalAuthFallback()) {
        const localUser = this.verifyLocalToken(accessToken);
        userId = localUser.id;
        role = localUser.role;
      } else {
        throw supabaseError;
      }
    }

    const accountSelect = {
      id: true,
      email: true,
      role: true,
      isSuspended: true,
    } as const;
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: accountSelect,
    });

    // Normal authenticated reads must not update the user and upsert both
    // wallets every time. Login/registration already synchronize the profile.
    // Retain first-use and legacy email-to-ID linking when no local row exists.
    if (!user && verifiedIdentity) {
      const synced = await this.supabaseService.syncUser(verifiedIdentity);
      user = await this.prisma.user.findUnique({
        where: { id: synced.id },
        select: accountSelect,
      });
    }

    if (!user) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('Account suspended');
    }

    if (verifiedIdentity && providerSessionId) {
      const activeSession = await this.prisma.refreshToken.findFirst({
        where: {
          userId: user.id,
          providerSessionId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });

      if (!activeSession) {
        throw new UnauthorizedException(
          'Session expired. Please sign in again.',
        );
      }
    }

    request.user = {
      userId: user.id,
      email: user.email,
      role: user.role || role,
      // Domain ownership identifies a staff candidate during signup only. It
      // never substitutes for the explicit database ADMIN assignment.
      canAccessAdmin: user.role === 'ADMIN',
    };

    return true;
  }

  private canUseLocalAuthFallback() {
    return (
      process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test'
    );
  }

  private verifyLocalToken(accessToken: string) {
    try {
      const secret = this.configService.getOrThrow<string>('JWT_SECRET');

      const decoded = jwt.verify(accessToken, secret) as {
        sub?: string;
        role?: string;
      };

      if (!decoded.sub) {
        throw new UnauthorizedException(
          'Session expired. Please sign in again.',
        );
      }

      return {
        id: decoded.sub,
        role: decoded.role || 'USER',
      };
    } catch {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
  }
}
