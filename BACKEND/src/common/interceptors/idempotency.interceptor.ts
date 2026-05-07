import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { RedisService } from '../../redis/redis.service';
import { PinoLogger } from 'nestjs-pino';

const IDEMPOTENCY_TTL = 86400; // 24 hours

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      return next.handle();
    }

    const cacheKey = `idempotency:${idempotencyKey}`;

    const existing = await this.redis.get(cacheKey);
    if (existing) {
      this.logger.info(
        { idempotencyKey },
        'Idempotency key matched, returning cached response',
      );
      return of(JSON.parse(existing));
    }

    const response = await next.handle().toPromise();

    if (response) {
      await this.redis.set(cacheKey, JSON.stringify(response), IDEMPOTENCY_TTL);
    }

    return of(response);
  }
}
