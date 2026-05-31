import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { WalletsModule } from "../wallets/wallets.module";
import { PaymentsModule } from "../payments/payments.module";
import { VtuModule } from "../vtu/vtu.module";

@Module({
  imports: [WalletsModule, PaymentsModule, VtuModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
