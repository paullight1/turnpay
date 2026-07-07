import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { RedisService } from "../../redis/redis.service";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryTimeout: number;
  halfOpenMaxRequests: number;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

@Injectable()
export class CircuitBreakerService {
  private readonly options: CircuitBreakerOptions = {
    failureThreshold: 5,
    recoveryTimeout: 60000,
    halfOpenMaxRequests: 3,
  };

  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {}

  private getStateKey(service: string): string {
    return `circuit:${service}:state`;
  }

  private getFailuresKey(service: string): string {
    return `circuit:${service}:failures`;
  }

  private getLastFailureKey(service: string): string {
    return `circuit:${service}:lastFailureAt`;
  }

  private getRequestsKey(service: string): string {
    return `circuit:${service}:halfOpenRequests`;
  }

  async getState(service: string): Promise<CircuitState> {
    const state = await this.redis.get(this.getStateKey(service));
    return (state as CircuitState) || "CLOSED";
  }

  async canExecute(service: string): Promise<boolean> {
    const state = await this.getState(service);

    if (state === "CLOSED") {
      return true;
    }

    if (state === "OPEN") {
      const lastFailureAt = await this.redis.get(
        this.getLastFailureKey(service),
      );
      if (!lastFailureAt) {
        await this.transitionTo(service, "HALF_OPEN");
        return true;
      }

      const lastFailure = parseInt(lastFailureAt, 10);
      if (Date.now() - lastFailure > this.options.recoveryTimeout) {
        await this.transitionTo(service, "HALF_OPEN");
        return true;
      }

      return false;
    }

    // HALF_OPEN
    const requests = await this.redis.get(this.getRequestsKey(service));
    const currentRequests = requests ? parseInt(requests, 10) : 0;

    if (currentRequests < this.options.halfOpenMaxRequests) {
      await this.redis.set(
        this.getRequestsKey(service),
        String(currentRequests + 1),
        30,
      );
      return true;
    }

    return false;
  }

  async recordSuccess(service: string): Promise<void> {
    await this.transitionTo(service, "CLOSED");
    this.logger.info({ service }, "Circuit breaker closed (success)");
  }

  async recordFailure(service: string): Promise<void> {
    const failuresKey = this.getFailuresKey(service);
    const failures = await this.redis.get(failuresKey);
    const count = failures ? parseInt(failures, 10) + 1 : 1;

    // Track the running failure count and the last-failure timestamp in
    // separate keys — conflating them (storing Date.now() in the count key)
    // makes the next read parse a ~1.7e12 timestamp as the count and trips the
    // breaker after a single subsequent failure regardless of the threshold.
    await this.redis.set(failuresKey, String(count), 300);
    await this.redis.set(
      this.getLastFailureKey(service),
      String(Date.now()),
      300,
    );

    if (count >= this.options.failureThreshold) {
      await this.transitionTo(service, "OPEN");
      this.logger.warn(
        { service, failureCount: count },
        "Circuit breaker opened after failures",
      );
    } else {
      this.logger.warn(
        {
          service,
          failureCount: count,
          threshold: this.options.failureThreshold,
        },
        "Circuit breaker failure recorded",
      );
    }
  }

  private async transitionTo(
    service: string,
    state: CircuitState,
  ): Promise<void> {
    await this.redis.set(this.getStateKey(service), state, 300);

    if (state === "CLOSED") {
      await this.redis.del(this.getFailuresKey(service));
      await this.redis.del(this.getLastFailureKey(service));
      await this.redis.del(this.getRequestsKey(service));
    }

    if (state === "HALF_OPEN") {
      await this.redis.set(this.getRequestsKey(service), "0", 30);
    }
  }
}
