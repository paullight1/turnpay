import { Module } from "@nestjs/common";
import { KycController, AdminKycController } from "./kyc.controller";
import { KycService } from "./kyc.service";
import { ManualKycProvider } from "./providers/manual-kyc.provider";
import { KYC_PROVIDER_GATEWAY } from "./providers/kyc-provider.gateway";

@Module({
  controllers: [KycController, AdminKycController],
  providers: [
    KycService,
    ManualKycProvider,
    {
      provide: KYC_PROVIDER_GATEWAY,
      useExisting: ManualKycProvider,
    },
  ],
})
export class KycModule {}
