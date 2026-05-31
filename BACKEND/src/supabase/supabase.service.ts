import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createClient,
  SupabaseClient,
  User as SupabaseUser,
} from "@supabase/supabase-js";
import { WalletCurrency } from "@prisma/client";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";

type TrustPaySupabaseClient = SupabaseClient<any, any, "public", any, any>;

@Injectable()
export class SupabaseService {
  public client: TrustPaySupabaseClient;
  public authClient: TrustPaySupabaseClient;
  public adminClient?: TrustPaySupabaseClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    const supabaseUrl = this.configService.getOrThrow<string>("SUPABASE_URL");
    const supabaseKey =
      this.configService.get<string>("SUPABASE_PUBLISHABLE_KEY") ||
      this.configService.getOrThrow<string>("SUPABASE_ANON_KEY");
    const supabaseServiceKey = this.configService.get<string>(
      "SUPABASE_SERVICE_ROLE_KEY",
    );

    this.authClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
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

    this.logger.info({}, "Supabase client initialized");
  }

  async verifyToken(accessToken: string) {
    const { data, error } = await this.authClient.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new Error(`Invalid Supabase token: ${error?.message}`);
    }

    return data.user;
  }

  createUserScopedClient(accessToken: string) {
    const supabaseUrl = this.configService.getOrThrow<string>("SUPABASE_URL");
    const supabaseKey =
      this.configService.get<string>("SUPABASE_PUBLISHABLE_KEY") ||
      this.configService.getOrThrow<string>("SUPABASE_ANON_KEY");

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
        "SUPABASE_SERVICE_ROLE_KEY is required for admin auth operations",
      );
    }

    return this.adminClient;
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

  async setAuthAppRole(userId: string, role: "USER" | "ADMIN") {
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
      throw new Error("Supabase user is missing an email address");
    }

    const phone = this.resolvePhone(supabaseUser);
    const fullName = this.resolveFullName(supabaseUser);
    const currencies: WalletCurrency[] = ["NGN", "GHS"];

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
                existing.phone.startsWith("supabase:")
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
              password: "",
              role: "USER",
              kycStatus: "PENDING",
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
      typeof metadataPhone === "string" && metadataPhone.trim().length > 0
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

    return typeof fullName === "string" && fullName.trim().length > 0
      ? fullName.trim()
      : undefined;
  }
}
