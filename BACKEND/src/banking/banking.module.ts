import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { BankingController } from "./banking.controller";
import { BankingService } from "./banking.service";
import { BeneficiariesService } from "./beneficiaries.service";
import { PaystackVirtualAccountProvider } from "./providers/paystack-virtual-account.provider";
import { MonnifyVirtualAccountProvider } from "./providers/monnify-virtual-account.provider";
import { WalletsModule } from "../wallets/wallets.module";

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5,
    }),
    WalletsModule,
  ],
  controllers: [BankingController],
  providers: [
    BankingService,
    BeneficiariesService,
    PaystackVirtualAccountProvider,
    MonnifyVirtualAccountProvider,
  ],
  exports: [BankingService, BeneficiariesService],
})
export class BankingModule {}
