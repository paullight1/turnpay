import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { VtuService } from "./vtu.service";
import { VtuRequeryService } from "./vtu-requery.service";
import { VtuController } from "./vtu.controller";
import { ReloadlyWebhookController } from "./reloadly-webhook.controller";
import { VtpassWebhookController } from "./vtpass-webhook.controller";
import { VtuApiProvider } from "./providers/vtu-api.provider";
import { ReloadlyProvider } from "./providers/reloadly.provider";
import { WalletsModule } from "../wallets/wallets.module";

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5,
    }),
    WalletsModule,
  ],
  controllers: [
    VtuController,
    ReloadlyWebhookController,
    VtpassWebhookController,
  ],
  providers: [VtuService, VtuRequeryService, VtuApiProvider, ReloadlyProvider],
  exports: [VtuService],
})
export class VtuModule {}
