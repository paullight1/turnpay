import { Module } from "@nestjs/common";
import { WalletsService } from "./wallets.service";
import { WalletsController } from "./wallets.controller";
import { LedgerService } from "./ledger.service";

@Module({
  controllers: [WalletsController],
  providers: [WalletsService, LedgerService],
  exports: [WalletsService, LedgerService],
})
export class WalletsModule {}
