import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AdminService } from "./admin.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import {
  AdminActionReasonDto,
  AdminAuditLogsQueryDto,
  AdminCreateVtuPricingRuleDto,
  AdminProviderEventsQueryDto,
  AdminTransactionStatusDto,
  AdminTransferVerificationDto,
  AdminUpdateUserDto,
  AdminUpdateVtuPricingRuleDto,
  AdminVtuReconciliationQueryDto,
  AdminVtuPricingRulesQueryDto,
  AdminUsersQueryDto,
  AdminVtuStaleOrdersQueryDto,
} from "./dto/admin.dto";
import { LimitQueryDto, ReferenceParamDto } from "../common/dto/query.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("users")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminService.getUsers(
      query.page,
      query.limit,
      query.role,
      query.kycStatus,
      query.q,
    );
  }

  @Get("users/:userId")
  async getUserById(@Param("userId") userId: string) {
    return this.adminService.getUserById(userId);
  }

  @Post("users/:userId/sessions/:sessionId/revoke")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async revokeUserSession(
    @CurrentUser() user: { userId: string },
    @Param("userId") userId: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: AdminActionReasonDto,
  ) {
    return this.adminService.revokeUserSession(
      userId,
      sessionId,
      dto,
      user.userId,
    );
  }

  @Put("users/:userId")
  async updateUser(
    @CurrentUser() user: { userId: string },
    @Param("userId") userId: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.adminService.updateUser(userId, dto, user.userId);
  }

  @Post("users/:userId/suspend")
  async suspendUser(
    @CurrentUser() user: { userId: string },
    @Param("userId") userId: string,
    @Body() dto: AdminActionReasonDto,
  ) {
    return this.adminService.suspendUser(userId, user.userId, dto);
  }

  @Post("users/:userId/unsuspend")
  async unsuspendUser(
    @CurrentUser() user: { userId: string },
    @Param("userId") userId: string,
    @Body() dto: AdminActionReasonDto,
  ) {
    return this.adminService.unsuspendUser(userId, user.userId, dto);
  }

  @Get("stats")
  async getStats() {
    return this.adminService.getStats();
  }

  @Get("ops/summary")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getOpsSummary(@Query() query: LimitQueryDto) {
    return this.adminService.getOpsSummary(query.limit);
  }

  @Get("transactions")
  async getRecentTransactions(@Query() query: LimitQueryDto) {
    return this.adminService.getRecentTransactions(query.limit);
  }

  @Get("transactions/:reference")
  async getTransactionDrilldown(@Param() params: ReferenceParamDto) {
    return this.adminService.getTransactionDrilldown(params.reference);
  }

  @Post("transactions/:reference/status")
  updateTransactionStatus(
    @CurrentUser() user: { userId: string },
    @Param("reference") reference: string,
    @Body() dto: AdminTransactionStatusDto,
  ) {
    return this.adminService.updateTransactionStatus(
      reference,
      dto.status,
      user.userId,
    );
  }

  @Get("banking/overview")
  async getBankingOverview() {
    return this.adminService.getBankingOverview();
  }

  @Get("banking/virtual-accounts")
  async getVirtualAccounts(@Query() query: LimitQueryDto) {
    return this.adminService.getVirtualAccounts(query.limit);
  }

  @Get("banking/provider-events")
  async getProviderEvents(@Query() query: AdminProviderEventsQueryDto) {
    return this.adminService.getProviderEvents(query.limit, query.status);
  }

  @Get("banking/transfers/pending")
  async getPendingTransfers(@Query() query: LimitQueryDto) {
    return this.adminService.getPendingWithdrawals(query.limit);
  }

  @Get("banking/transfers/:reference")
  async getWithdrawalDrilldown(@Param() params: ReferenceParamDto) {
    return this.adminService.getWithdrawalDrilldown(params.reference);
  }

  @Post("banking/transfers/:reference/verify")
  async verifyTransfer(
    @CurrentUser() user: { userId: string },
    @Param("reference") reference: string,
    @Body() dto: AdminTransferVerificationDto,
  ) {
    return this.adminService.verifyTransfer(reference, dto, user.userId);
  }

  @Get("banking/reconciliation")
  async getReconciliationReport() {
    return this.adminService.getReconciliationReport();
  }

  @Get("vtu/reconciliation")
  async getVtuReconciliation(@Query() query: AdminVtuReconciliationQueryDto) {
    return this.adminService.getVtuReconciliationReport(
      query.olderThanMinutes,
      query.limit,
    );
  }

  @Get("vtu/orders/stale")
  async getStaleVtuOrders(@Query() query: AdminVtuStaleOrdersQueryDto) {
    return this.adminService.getStaleVtuOrders(
      query.olderThanMinutes,
      query.limit,
    );
  }

  @Get("vtu/providers/health")
  async getVtuProviderHealth() {
    return this.adminService.getVtuProviderHealth();
  }

  @Post("vtu/orders/:reference/requery")
  async requeryVtuOrder(
    @CurrentUser() user: { userId: string },
    @Param("reference") reference: string,
    @Body() dto: AdminActionReasonDto,
  ) {
    return this.adminService.requeryVtuOrder(reference, dto, user.userId);
  }

  @Get("vtu/pricing-rules")
  async listVtuPricingRules(@Query() query: AdminVtuPricingRulesQueryDto) {
    return this.adminService.listVtuPricingRules(query);
  }

  @Post("vtu/pricing-rules")
  async createVtuPricingRule(
    @CurrentUser() user: { userId: string },
    @Body() dto: AdminCreateVtuPricingRuleDto,
  ) {
    return this.adminService.createVtuPricingRule(dto, user.userId);
  }

  @Put("vtu/pricing-rules/:ruleId")
  async updateVtuPricingRule(
    @CurrentUser() user: { userId: string },
    @Param("ruleId") ruleId: string,
    @Body() dto: AdminUpdateVtuPricingRuleDto,
  ) {
    return this.adminService.updateVtuPricingRule(ruleId, dto, user.userId);
  }

  @Post("vtu/pricing-rules/:ruleId/deactivate")
  async deactivateVtuPricingRule(
    @CurrentUser() user: { userId: string },
    @Param("ruleId") ruleId: string,
    @Body() dto: AdminActionReasonDto,
  ) {
    return this.adminService.deactivateVtuPricingRule(ruleId, dto, user.userId);
  }

  @Post("banking/reconciliation/run")
  async runReconciliation(
    @CurrentUser() user: { userId: string },
    @Body() dto: AdminActionReasonDto,
  ) {
    return this.adminService.runReconciliation(user.userId, dto);
  }

  @Get("audit-logs")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getAuditLogs(@Query() query: AdminAuditLogsQueryDto) {
    return this.adminService.getAuditLogs(query);
  }
}
