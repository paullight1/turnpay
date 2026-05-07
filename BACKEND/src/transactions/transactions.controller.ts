import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  async getUserTransactions(
    @CurrentUser() user: { userId: string },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

    return this.transactionsService.getUserTransactions(
      user.userId,
      pageNum,
      limitNum,
      status,
      type,
    );
  }

  @Get(':reference')
  async getTransactionByReference(
    @CurrentUser() user: { userId: string },
    @Param('reference') reference: string,
  ) {
    const transaction = await this.transactionsService.getTransactionByReference(
      reference,
      user.userId,
    );

    if (!transaction) {
      return { error: 'Transaction not found' };
    }

    return transaction;
  }

  @Get('all')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async getAllTransactions(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

    return this.transactionsService.getAllTransactions(
      pageNum,
      limitNum,
      status,
      type,
    );
  }
}
