import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { UsersModule } from "../users/users.module";
import { WalletsModule } from "../wallets/wallets.module";
import { OtpModule } from "../otp/otp.module";
import { SupabaseModule } from "../supabase/supabase.module";

@Module({
  imports: [
    UsersModule,
    WalletsModule,
    OtpModule,
    PassportModule,
    SupabaseModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
