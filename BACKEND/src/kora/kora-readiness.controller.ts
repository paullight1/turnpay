import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { KoraCapabilitiesService } from './kora-capabilities.service';
import { KoraPayoutsService } from './kora-payouts.service';
@Controller('admin/payments/kora')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class KoraReadinessController {
  constructor(
    private readonly capabilities: KoraCapabilitiesService,
    private readonly payouts: KoraPayoutsService,
    private readonly config: ConfigService,
  ) {}
  @Get('readiness')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async readiness() {
    const capabilities = this.capabilities.get();
    let balance: { currency: 'GHS'; available: string } | null = null;
    let balanceStatus = 'NOT_CONFIGURED';
    if (capabilities.enabled && capabilities.configured) {
      try {
        balance = {
          currency: 'GHS',
          available: (await this.payouts.balance()).toFixed(2),
        };
        balanceStatus = 'VERIFIED';
      } catch {
        balanceStatus = 'UNAVAILABLE';
      }
    }
    return {
      ...capabilities,
      activationStatus: 'UNCONFIRMED',
      balance,
      balanceStatus,
      limitsConfigured:
        Number(this.config.get('KORA_GHS_DAILY_LIMIT', 0)) > 0 &&
        Number(this.config.get('KORA_GHS_MONTHLY_LIMIT', 0)) > 0,
      message:
        'Configuration and balance do not confirm merchant approval. Complete signed sandbox receipt and payout verification before live activation.',
    };
  }
}
