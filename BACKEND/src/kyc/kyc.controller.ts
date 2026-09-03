import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Headers,
  HttpCode,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateKycUploadDto,
  ReviewKycDto,
  CreateDisputeDto,
  ResolveDisputeDto,
  CreateIdentityVerificationDto,
  YouverifyWebhookDto,
} from './dto/kyc.dto';
import type { RawBodyRequest } from '../common/types/request-context';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('document-upload-url')
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  async createDocumentUploadUrl(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateKycUploadDto,
  ) {
    return this.kycService.createDocumentUploadUrl(user.userId, dto);
  }

  @Post('youverify/verify')
  @Throttle({ default: { limit: 3, ttl: 86400000 } })
  async verifyWithYouverify(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateIdentityVerificationDto,
  ) {
    return this.kycService.verifyIdentity(user.userId, dto);
  }

  @Post('verify')
  @Throttle({ default: { limit: 3, ttl: 86400000 } })
  async verifyIdentity(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateIdentityVerificationDto,
  ) {
    return this.kycService.verifyIdentity(user.userId, dto);
  }

  @Get('status')
  async getKycStatus(@CurrentUser() user: { userId: string }) {
    return this.kycService.getUserKycStatus(user.userId);
  }

  @Get('documents')
  async getUserKyc(@CurrentUser() user: { userId: string }) {
    return this.kycService.getUserKyc(user.userId);
  }

  @Post('disputes')
  @Throttle({ default: { limit: 5, ttl: 86400000 } })
  async createDispute(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateDisputeDto,
  ) {
    return this.kycService.createDispute(user.userId, dto);
  }

  @Get('disputes')
  async getUserDisputes(
    @CurrentUser() user: { userId: string },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.kycService.getUserDisputes(
      user.userId,
      Math.max(1, parseInt(page, 10)),
      Math.min(100, Math.max(1, parseInt(limit, 10))),
    );
  }
}

@Controller('webhooks/kyc')
export class KycWebhookController {
  constructor(private readonly kycService: KycService) {}

  @Post('youverify')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleYouverifyWebhook(
    @Headers('x-youverify-signature') youverifySignature: string | undefined,
    @Req() req: RawBodyRequest,
    @Body() body: YouverifyWebhookDto,
  ) {
    return this.kycService.processYouverifyCallback({
      body: body as unknown as Record<string, unknown>,
      rawBody: req.rawBody,
      signatureHeader: youverifySignature,
    });
  }
}

@Controller('admin/kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminKycController {
  constructor(private readonly kycService: KycService) {}

  @Get('pending')
  async getPendingKyc(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.kycService.getAllPendingKyc(
      Math.max(1, parseInt(page, 10)),
      Math.min(100, Math.max(1, parseInt(limit, 10))),
    );
  }

  @Post(':documentId/document-url')
  async createDocumentReviewUrl(
    @CurrentUser() user: { userId: string },
    @Param('documentId') documentId: string,
  ) {
    return this.kycService.createAdminDocumentReviewUrl(
      documentId,
      user.userId,
    );
  }

  @Put(':documentId/review')
  async reviewKyc(
    @CurrentUser() user: { userId: string },
    @Param('documentId') documentId: string,
    @Body() dto: ReviewKycDto,
  ) {
    return this.kycService.reviewKyc(documentId, dto, user.userId);
  }

  @Get('disputes')
  async getAllDisputes(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    return this.kycService.getAllDisputes(
      Math.max(1, parseInt(page, 10)),
      Math.min(100, Math.max(1, parseInt(limit, 10))),
      status,
    );
  }

  @Put('disputes/:disputeId/resolve')
  async resolveDispute(
    @CurrentUser() user: { userId: string },
    @Param('disputeId') disputeId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.kycService.resolveDispute(disputeId, dto, user.userId);
  }
}
