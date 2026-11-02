import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  PaystackAdverseCaseQueryDto,
  RecheckPaystackAdverseCaseDto,
  ResolvePaystackAdverseCaseDto,
} from './dto/paystack-adverse-funding.dto';
import { PaystackAdverseFundingService } from './paystack-adverse-funding.service';

/**
 * Small, separately owned operator surface for adverse Paystack funding. It
 * deliberately does not reuse the generic customer-support dispute route:
 * resolving a provider exposure may move wallet value and therefore requires
 * the dedicated financial service and audited idempotent mutation.
 */
@Controller('admin/payments/adverse-funding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class PaystackAdverseFundingController {
  constructor(private readonly adverseFunding: PaystackAdverseFundingService) {}

  @Get('cases')
  getCases(@Query() query: PaystackAdverseCaseQueryDto) {
    return this.adverseFunding.listCases(query.status);
  }

  @Post('cases/:caseId/recheck')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  recheckCase(
    @CurrentUser() user: { userId: string },
    @Param('caseId', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Body() dto: RecheckPaystackAdverseCaseDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') legacyIdempotencyKey?: string,
  ) {
    return this.adverseFunding.recheckCase(caseId, user.userId, {
      reason: dto.reason,
      operationKey: idempotencyKey ?? legacyIdempotencyKey,
    });
  }

  @Post('cases/:caseId/resolve')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  resolveCase(
    @CurrentUser() user: { userId: string },
    @Param('caseId', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Body() dto: ResolvePaystackAdverseCaseDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-idempotency-key') legacyIdempotencyKey?: string,
  ) {
    return this.adverseFunding.resolveCase(caseId, user.userId, {
      ...dto,
      operationKey: idempotencyKey ?? legacyIdempotencyKey,
    });
  }
}
