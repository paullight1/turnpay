import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BankingService } from './banking.service';
import {
  CreateBeneficiaryDto,
  ProvisionVirtualAccountDto,
  ResolveBankAccountDto,
} from './dto/banking.dto';
import { BeneficiariesService } from './beneficiaries.service';

@Controller('banking')
@UseGuards(JwtAuthGuard)
export class BankingController {
  constructor(
    private readonly bankingService: BankingService,
    private readonly beneficiariesService: BeneficiariesService,
  ) {}

  @Get('accounts')
  async getVirtualAccounts(@CurrentUser() user: { userId: string }) {
    return this.bankingService.getVirtualAccounts(user.userId);
  }

  @Post('accounts/provision')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async provisionVirtualAccount(
    @CurrentUser() user: { userId: string },
    @Body() dto: ProvisionVirtualAccountDto,
  ) {
    return this.bankingService.provisionVirtualAccount(user.userId, dto);
  }

  @Get('banks')
  async listBanks() {
    return this.beneficiariesService.listBanks();
  }

  @Post('banks/resolve')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resolveBank(@Body() dto: ResolveBankAccountDto) {
    return this.beneficiariesService.resolveBankAccount(dto);
  }

  @Post('beneficiaries')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async createBeneficiary(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateBeneficiaryDto,
  ) {
    return this.beneficiariesService.createBeneficiary(user.userId, dto);
  }

  @Get('beneficiaries')
  async getBeneficiaries(@CurrentUser() user: { userId: string }) {
    return this.beneficiariesService.getBeneficiaries(user.userId);
  }

  @Delete('beneficiaries/:id')
  async deleteBeneficiary(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.beneficiariesService.deleteBeneficiary(user.userId, id);
  }
}
