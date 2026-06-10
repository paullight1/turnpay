import {
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { LoggerService } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Request, Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: LoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage =
      exception instanceof HttpException
        ? this.normalizeExceptionResponse(exception.getResponse())
        : "Internal server error";

    const responseBody = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: request.originalUrl || request.url,
      message: this.sanitizeAuthMessage(
        request.path,
        request.method,
        httpStatus,
        rawMessage,
      ),
    };

    this.logger.error(responseBody);

    httpAdapter.reply(response, responseBody, httpStatus);
  }

  private sanitizeAuthMessage(
    path: string | undefined,
    method: string,
    status: number,
    rawMessage: string | Record<string, unknown> | Array<unknown>,
  ) {
    if (!path?.startsWith("/api/auth/")) {
      return rawMessage;
    }

    if (path.endsWith("/auth/login") && status === 401) {
      return "Unable to sign in with those credentials";
    }

    if (path.endsWith("/auth/refresh") && status === 401) {
      return "Session expired. Please sign in again.";
    }

    if (
      (path.endsWith("/auth/register") ||
        path.includes("/api/auth/register")) &&
      status === 409
    ) {
      return "Unable to complete registration";
    }

    if (
      (path.includes("/api/auth/otp") ||
        path.includes("/api/auth/forgot-password")) &&
      status === 400
    ) {
      return "Authentication request failed";
    }

    if (method === "GET" && path.includes("/api/auth/sessions")) {
      return "Session action failed";
    }

    return rawMessage;
  }

  private normalizeExceptionResponse(
    value: string | object,
  ): string | Record<string, unknown> | Array<unknown> {
    if (typeof value === "string" || Array.isArray(value)) {
      return value;
    }

    return value as Record<string, unknown>;
  }
}
