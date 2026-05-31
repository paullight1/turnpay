import { Module, Global } from "@nestjs/common";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { RedisModule } from "../../redis/redis.module";

@Global()
@Module({
  imports: [RedisModule],
  providers: [CircuitBreakerService],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule {}
