import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../../redis/redis.service';
import { PinoLogger } from 'nestjs-pino';

const IDEMPOTENCY_TTL = 86400; // 24 hours
const IDEMPOTENCY_LOCK_TTL = 30;

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
    const method = request.method?.toUpperCase();
    const path = request.originalUrl || request.url || '';
    const shouldProcess =
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
      !path.startsWith('/api/webhooks') &&
      !path.startsWith('/api/auth');

    if (!shouldProcess) {
      return next.handle();
    }

    const idempotencyKey =
      request.headers['idempotency-key'] ||
      request.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const userId = request.user?.userId || 'anonymous';
    const cacheKey = `idempotency:${userId}:${idempotencyKey}`;
    const lockKey = `${cacheKey}:lock`;

    const existing = await this.redis.get(cacheKey);
    if (existing) {
      this.logger.info(
        { idempotencyKey },
        'Idempotency key matched, returning cached response',
      );
      return of(JSON.parse(existing));
    }

    const lock = await this.redis.setIfNotExists(
      lockKey,
      '1',
      IDEMPOTENCY_LOCK_TTL,
    );

    if (!lock) {
      throw new ConflictException(
        'Request with this idempotency key is already in progress',
      );
    }

    try {
      const response = await lastValueFrom(next.handle());

      if (response) {
        await this.redis.set(
          cacheKey,
          JSON.stringify(response),
          IDEMPOTENCY_TTL,
        );
      }

      return of(response);
    } finally {
      await this.redis.del(lockKey);
    }
  }
}
