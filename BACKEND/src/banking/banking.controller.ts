import type { Response } from 'express';
import {
  Body,
  BadRequestException,
  Headers,
  Res,
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
  RequestAccountSetupDto,
  AccountSetupResponseDto,
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

  @Get('accounts/provisioning')
  provisioning(@CurrentUser() user: { userId: string }) {
    return this.bankingService.getAccountProvisioning(user.userId);
  }

  @Post('accounts/provision')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async provisionVirtualAccount(
    @CurrentUser() user: { userId: string },
    @Body() dto: ProvisionVirtualAccountDto,
    @Res({ passthrough: true }) response?: Response,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') legacyKey?: string,
  ) {
    const attemptKey = this.accountAttemptKey(key, legacyKey);
    const account = await this.bankingService.provisionVirtualAccount(
      user.userId,
      dto,
      attemptKey,
    );
    response?.status(account.status === 'PENDING' ? 202 : 201);
    return account;
  }

  @Post('accounts/setup-request')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  requestAccountSetup(
    @CurrentUser() user: { userId: string },
    @Body() dto: RequestAccountSetupDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') legacyKey?: string,
  ): Promise<AccountSetupResponseDto> {
    this.accountAttemptKey(key, legacyKey);
    return this.bankingService.requestAccountSetup(user.userId, dto);
  }

  private accountAttemptKey(key?: string, legacyKey?: string): string {
    const value = key ?? legacyKey ?? '';
    if (!/^[A-Za-z0-9:_-]{16,128}$/.test(value)) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    return value;
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
