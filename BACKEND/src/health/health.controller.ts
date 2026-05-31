import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const checks: Record<string, string> = {};
    let isHealthy = true;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = "connected";
    } catch {
      checks.database = "disconnected";
      isHealthy = false;
    }

    try {
      await this.redis.getClient().ping();
      checks.redis = "connected";
    } catch {
      checks.redis = "disconnected";
      isHealthy = false;
    }

    const response = {
      status: isHealthy ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    };

    if (!isHealthy) {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }
}
