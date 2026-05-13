import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminUpdateUserDto } from './dto/admin.dto';
import { TransactionStatus } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getUsers(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('role') role?: string,
    @Query('kycStatus') kycStatus?: string,
  ) {
    return this.adminService.getUsers(
      Math.max(1, parseInt(page, 10)),
      Math.min(100, Math.max(1, parseInt(limit, 10))),
      role,
      kycStatus,
    );
  }

  @Get('users/:userId')
  async getUserById(@Param('userId') userId: string) {
    return this.adminService.getUserById(userId);
  }

  @Put('users/:userId')
  async updateUser(
    @CurrentUser() user: { userId: string },
    @Param('userId') userId: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.adminService.updateUser(userId, dto, user.userId);
  }

  @Post('users/:userId/suspend')
  async suspendUser(
    @CurrentUser() user: { userId: string },
    @Param('userId') userId: string,
  ) {
    return this.adminService.suspendUser(userId, user.userId);
  }

  @Post('users/:userId/unsuspend')
  async unsuspendUser(
    @CurrentUser() user: { userId: string },
    @Param('userId') userId: string,
  ) {
    return this.adminService.unsuspendUser(userId, user.userId);
  }

  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  @Get('transactions')
  async getRecentTransactions(@Query('limit') limit = '20') {
    return this.adminService.getRecentTransactions(
      Math.min(100, Math.max(1, parseInt(limit, 10))),
    );
  }

  @Post('transactions/:reference/status')
  async updateTransactionStatus(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
    @Body('status') status: TransactionStatus,
  ) {
    return this.adminService.updateTransactionStatus(
      reference,
      status,
      user.userId,
    );
  }
}
