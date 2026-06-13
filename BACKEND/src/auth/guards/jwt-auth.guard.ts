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

type RequestWithUser = {
  headers: {
    authorization?: string;
  };
  user?: {
    userId: string;
    email: string;
    role: string;
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

    try {
      const supabaseUser = await this.supabaseService.verifyToken(accessToken);
      const user = await this.supabaseService.syncUser(supabaseUser);
      userId = user.id;
      role = user.role;
    } catch (supabaseError) {
      if (this.canUseLocalAuthFallback()) {
        const localUser = this.verifyLocalToken(accessToken);
        userId = localUser.id;
        role = localUser.role;
      } else {
        throw supabaseError;
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isSuspended: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('Account suspended');
    }

    request.user = {
      userId: user.id,
      email: user.email,
      role: user.role || role,
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
