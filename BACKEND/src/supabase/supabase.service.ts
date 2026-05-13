import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  public client: SupabaseClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseKey =
      this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');
    const supabaseServiceKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    this.client = createClient(supabaseUrl, supabaseServiceKey || supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log('Supabase client initialized');
  }

  async verifyToken(accessToken: string) {
    const { data, error } = await this.client.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new Error(`Invalid Supabase token: ${error?.message}`);
    }

    return data.user;
  }

  async syncUser(supabaseUser: any) {
    const existing = await this.prisma.user.findUnique({
      where: { email: supabaseUser.email },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.user.create({
      data: {
        id: supabaseUser.id,
        email: supabaseUser.email,
        phone: supabaseUser.phone || supabaseUser.user_metadata?.phone || '',
        password: '',
        role: 'USER',
        kycStatus: 'PENDING',
      },
    });
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }
}
