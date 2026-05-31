import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { SupabaseService } from "../../supabase/supabase.service";

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
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();
    if (!accessToken) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const supabaseUser = await this.supabaseService.verifyToken(accessToken);
    const user = await this.supabaseService.syncUser(supabaseUser);

    if (user.isSuspended) {
      throw new ForbiddenException("Account suspended");
    }

    request.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    return true;
  }
}
