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
// A crash between claiming the IN_PROGRESS record and completing the handler
// would otherwise strand the key as IN_PROGRESS until expiresAt (24h). After
// this lease elapses a retry may atomically take over the stale record.
const IDEMPOTENCY_IN_PROGRESS_LEASE = 120; // 2 minutes

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

    let recordId: string;
    let useRedisLock = false;

    if (existingRecord) {
      const resolved = this.resolveExistingRecord(existingRecord, requestHash);
      if (resolved) {
        return resolved;
      }

      // Lease expired on a stranded IN_PROGRESS record (handler crashed
      // before completing). Atomically claim it so this retry can proceed;
      // the updatedAt guard ensures only one concurrent retry wins.
      const takenOver = await this.prisma.idempotencyRecord.updateMany({
        where: {
          id: existingRecord.id,
          status: "IN_PROGRESS",
          updatedAt: existingRecord.updatedAt,
        },
        data: { requestHash, expiresAt },
      });

      if (takenOver.count !== 1) {
        throw new ConflictException(
          "Request with this idempotency key is already in progress",
        );
      }

      recordId = existingRecord.id;
    } else {
      useRedisLock = this.redis.isAvailable();
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
      recordId = record.id;
    }

    try {
      const response: unknown = await lastValueFrom(
        next.handle() as Observable<unknown>,
      );

      // Always transition out of IN_PROGRESS on success — including when the
      // handler returns undefined. Otherwise the record is stranded until
      // expiresAt (24h) and every retry with the same key gets a spurious
      // "already in progress" ConflictException.
      const responseJson =
        response === undefined ? Prisma.JsonNull : this.toJsonValue(response);
      await this.prisma.idempotencyRecord.update({
        where: { id: recordId },
        data: {
          status: "COMPLETED",
          response: responseJson,
          expiresAt,
        },
      });
      if (this.redis.isAvailable()) {
        await this.redis.set(
          cacheKey,
          JSON.stringify({
            requestHash,
            response: response === undefined ? null : responseJson,
          }),
          IDEMPOTENCY_TTL,
        );
      }

      return of(response);
    } catch (error) {
      // Only deterministic client errors (4xx HttpExceptions) are safe to
      // persist as a replayable final failure. Transient faults — non-HTTP
      // errors (DB blip, timeout) and 5xx — must NOT be memoized: delete the
      // in-progress record and skip the failure cache so the client can retry
      // and succeed instead of being served a stale error for 24h.
      const isTransient =
        !(error instanceof HttpException) || error.getStatus() >= 500;

      if (isTransient) {
        await this.prisma.idempotencyRecord
          .delete({ where: { id: recordId } })
          .catch(() => undefined);
        throw error;
      }

      const httpStatus =
        error instanceof HttpException ? error.getStatus() : 500;
      const errorResponse = this.toJsonValue(
        error instanceof HttpException
          ? error.getResponse()
          : { statusCode: 500, message: "Internal server error" },
      );
      await this.prisma.idempotencyRecord.update({
        where: { id: recordId },
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

  // Returns a replayable Observable when the prior request reached a terminal
  // state, or null when the record is a stale IN_PROGRESS lease the caller may
  // take over. Throws for an active in-flight request or a body mismatch.
  private resolveExistingRecord(
    record: {
      requestHash: string;
      status: string;
      response: unknown;
      httpStatus?: number | null;
      errorResponse?: unknown;
      updatedAt?: Date | null;
    },
    requestHash: string,
  ): Observable<unknown> | null {
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

    // IN_PROGRESS: block only while the lease is still fresh. Once it lapses
    // the record is assumed stranded and the caller may reclaim it.
    const leaseCutoff = Date.now() - IDEMPOTENCY_IN_PROGRESS_LEASE * 1000;
    if (record.updatedAt && record.updatedAt.getTime() > leaseCutoff) {
      throw new ConflictException(
        "Request with this idempotency key is already in progress",
      );
    }

    return null;
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
