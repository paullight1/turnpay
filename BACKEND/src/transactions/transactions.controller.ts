import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ReferenceParamDto,
  TransactionQueryDto,
} from '../common/dto/query.dto';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  async getUserTransactions(
    @CurrentUser() user: { userId: string },
    @Query() query: TransactionQueryDto,
  ) {
    return this.transactionsService.getUserTransactions(
      user.userId,
      query.page,
      query.limit,
      query.status,
      query.type,
    );
  }

  @Get('all')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async getAllTransactions(@Query() query: TransactionQueryDto) {
    return this.transactionsService.getAllTransactions(
      query.page,
      query.limit,
      query.status,
      query.type,
    );
  }

  @Get(':reference')
  async getTransactionByReference(
    @CurrentUser() user: { userId: string },
    @Param() params: ReferenceParamDto,
  ) {
    const transaction =
      await this.transactionsService.getTransactionByReference(
        params.reference,
        user.userId,
      );

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  @Get(':reference/admin')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async getTransactionDetailAdmin(@Param() params: ReferenceParamDto) {
    const transaction =
      await this.transactionsService.getTransactionDetailForAdmin(
        params.reference,
      );

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  @Get(':reference/audit-trail')
  @Roles('ADMIN')
  @UseGuards(RolesGuard)
  async getTransactionAuditTrail(@Param() params: ReferenceParamDto) {
    const auditLogs = await this.transactionsService.getTransactionAuditTrail(
      params.reference,
    );

    return { auditLogs };
  }
}
