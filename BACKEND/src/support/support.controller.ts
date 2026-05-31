import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import {
  CreateSupportTicketDto,
  isSupportTicketStatus,
  ResolveSupportTicketDto,
} from "./dto/support.dto";
import { SupportService } from "./support.service";

@Controller("support")
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post("tickets")
  @Throttle({ default: { limit: 5, ttl: 86400000 } })
  createTicket(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateSupportTicketDto,
  ) {
    return this.supportService.createTicket(user.userId, dto);
  }

  @Get("tickets")
  getUserTickets(
    @CurrentUser() user: { userId: string },
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("status") status?: string,
  ) {
    return this.supportService.getUserTickets(
      user.userId,
      Math.max(1, parseInt(page, 10)),
      Math.min(100, Math.max(1, parseInt(limit, 10))),
      isSupportTicketStatus(status) ? status : undefined,
    );
  }
}

@Controller("admin/support")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminSupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get("tickets")
  getAdminTickets(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("status") status?: string,
  ) {
    return this.supportService.getAdminTickets(
      Math.max(1, parseInt(page, 10)),
      Math.min(100, Math.max(1, parseInt(limit, 10))),
      isSupportTicketStatus(status) ? status : undefined,
    );
  }

  @Put("tickets/:ticketId/resolve")
  resolveTicket(
    @CurrentUser() user: { userId: string },
    @Param("ticketId") ticketId: string,
    @Body() dto: ResolveSupportTicketDto,
  ) {
    return this.supportService.resolveTicket(ticketId, dto, user.userId);
  }
}
