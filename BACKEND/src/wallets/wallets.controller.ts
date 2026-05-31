import { Controller, Get, UseGuards } from "@nestjs/common";
import { WalletsService } from "./wallets.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Controller("wallets")
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  async getWallets(@CurrentUser() user: { userId: string }) {
    return this.walletsService.getWallets(user.userId);
  }
}
