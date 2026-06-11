import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  HttpException,
} from "@nestjs/common";
import { Observable, of } from "rxjs";
import { lastValueFrom } from "rxjs";
import { createHash } from "crypto";
import { RedisService } from "../../redis/redis.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PinoLogger } from "nestjs-pino";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest } from "../types/request-context";

const IDEMPOTENCY_TTL = 86400; // 24 hours
const IDEMPOTENCY_LOCK_TTL = 30;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const method = request.method.toUpperCase();
    const path = request.originalUrl || request.url || "";
    const normalizedPath = path.split("?")[0];
    const shouldProcess =
      ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
      !normalizedPath.startsWith("/api/webhooks") &&
      !normalizedPath.startsWith("/api/auth") &&
      !this.isIdempotencyExemptRoute(normalizedPath);

    if (!shouldProcess) {
      return next.handle();
    }

    const idempotencyKey =
      request.headers["idempotency-key"] ||
      request.headers["x-idempotency-key"];

    if (typeof idempotencyKey !== "string") {
      throw new BadRequestException("Idempotency-Key header is required");
    }

    const userId = request.user?.userId || "anonymous";
    const requestHash = this.hashRequestBody(request.body);
    const scope = `${userId}:${method}:${normalizedPath}`;
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL * 1000);
    const cacheKey = `idempotency:${scope}:${idempotencyKey}`;
    const lockKey = `${cacheKey}:lock`;

    const existing = await this.redis.get(cacheKey);
    if (existing) {
      const cached = this.parseJson(existing);
      if (this.isCachedIdempotencyResponse(cached)) {
        if (cached.requestHash !== requestHash) {
          throw new ConflictException(
            "Idempotency-Key was already used with a different request body",
          );
        }

        if (cached.status === "FAILED_FINAL") {
          throw new HttpException(
            cached.errorResponse ?? { message: "Request failed" },
            cached.httpStatus ?? 500,
          );
        }

        this.logger.info(
          { idempotencyKey },
          "Idempotency key matched, returning cached response",
        );
        return of(cached.response);
      }

      this.logger.info(
        { idempotencyKey },
        "Idempotency key matched, returning cached response",
      );
      return of(cached);
    }

    const existingRecord = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_key: {
          scope,
          key: idempotencyKey,
        },
      },
    });

    if (existingRecord) {
      return this.resolveExistingRecord(existingRecord, requestHash);
    }

    const useRedisLock = this.redis.isAvailable();
    const lock = useRedisLock
      ? await this.redis.setIfNotExists(lockKey, "1", IDEMPOTENCY_LOCK_TTL)
      : true;

    if (!lock) {
      throw new ConflictException(
        "Request with this idempotency key is already in progress",
      );
    }

    const record = await this.createInProgressRecord({
      scope,
      key: idempotencyKey,
      method,
      path: normalizedPath,
      requestHash,
      expiresAt,
    });

    try {
      const response: unknown = await lastValueFrom(
        next.handle() as Observable<unknown>,
      );

      if (response !== undefined) {
        const responseJson = this.toJsonValue(response);
        await this.prisma.idempotencyRecord.update({
          where: { id: record.id },
          data: {
            status: "COMPLETED",
            response: responseJson,
            expiresAt,
          },
        });
        if (this.redis.isAvailable()) {
          await this.redis.set(
            cacheKey,
            JSON.stringify({ requestHash, response: responseJson }),
            IDEMPOTENCY_TTL,
          );
        }
      }

      return of(response);
    } catch (error) {
      const httpStatus =
        error instanceof HttpException ? error.getStatus() : 500;
      const errorResponse = this.toJsonValue(
        error instanceof HttpException
          ? error.getResponse()
          : { statusCode: 500, message: "Internal server error" },
      );
      await this.prisma.idempotencyRecord.update({
        where: { id: record.id },
        data: {
          status: "FAILED_FINAL",
          httpStatus,
          errorResponse,
          errorMessage:
            error instanceof Error ? error.message : "Request failed",
          expiresAt,
        },
      });
      if (this.redis.isAvailable()) {
        await this.redis.set(
          cacheKey,
          JSON.stringify({
            requestHash,
            status: "FAILED_FINAL",
            httpStatus,
            errorResponse,
          }),
          IDEMPOTENCY_TTL,
        );
      }
      throw error;
    } finally {
      if (useRedisLock) {
        await this.redis.del(lockKey);
      }
    }
  }

  private isIdempotencyExemptRoute(path: string) {
    return (
      path === "/api/payments/banks/resolve" ||
      path === "/api/banking/banks/resolve"
    );
  }

  private hashRequestBody(body: unknown) {
    return createHash("sha256")
      .update(JSON.stringify(body ?? {}))
      .digest("hex");
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return this.parseJson(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private parseJson(value: string): unknown {
    return JSON.parse(value) as unknown;
  }

  private isCachedIdempotencyResponse(value: unknown): value is {
    requestHash: string;
    status?: string;
    response?: unknown;
    httpStatus?: number;
    errorResponse?: unknown;
  } {
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { requestHash?: unknown }).requestHash === "string" &&
      ("response" in value || "errorResponse" in value)
    );
  }

  private resolveExistingRecord(
    record: {
      requestHash: string;
      status: string;
      response: unknown;
      httpStatus?: number | null;
      errorResponse?: unknown;
    },
    requestHash: string,
  ) {
    if (record.requestHash !== requestHash) {
      throw new ConflictException(
        "Idempotency-Key was already used with a different request body",
      );
    }

    if (record.status === "COMPLETED") {
      return of(record.response);
    }

    if (record.status === "FAILED_FINAL") {
      throw new HttpException(
        record.errorResponse ?? { message: "Request failed" },
        record.httpStatus ?? 500,
      );
    }

    throw new ConflictException(
      "Request with this idempotency key is already in progress",
    );
  }

  private async createInProgressRecord(data: {
    scope: string;
    key: string;
    method: string;
    path: string;
    requestHash: string;
    expiresAt: Date;
  }) {
    try {
      return await this.prisma.idempotencyRecord.create({ data });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.idempotencyRecord.findUnique({
          where: {
            scope_key: {
              scope: data.scope,
              key: data.key,
            },
          },
        });

        if (existing?.requestHash !== data.requestHash) {
          throw new ConflictException(
            "Idempotency-Key was already used with a different request body",
          );
        }

        throw new ConflictException(
          "Request with this idempotency key is already in progress",
        );
      }

      throw error;
    }
  }
}
