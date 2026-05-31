import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { InternalTransferDto } from "./dto/internal-transfer.dto";
import { TransfersService } from "./transfers.service";

@Controller("transfers")
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post("internal")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  sendInternalTransfer(
    @CurrentUser() user: { userId: string },
    @Body() dto: InternalTransferDto,
  ) {
    return this.transfersService.sendInternalTransfer(user.userId, dto);
  }

  @Get("internal/:reference")
  getInternalTransfer(
    @CurrentUser() user: { userId: string },
    @Param("reference") reference: string,
  ) {
    return this.transfersService.getInternalTransferByReference(
      user.userId,
      reference,
    );
  }
}
