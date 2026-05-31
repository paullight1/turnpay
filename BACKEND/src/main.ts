import { json } from "body-parser";
import { ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import * as Sentry from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import helmet from "helmet";
import type { Server } from "http";
import { NativeLogger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { IdempotencyInterceptor } from "./common/interceptors/idempotency.interceptor";
import type { RawBodyRequest } from "./common/types/request-context";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const logger = app.get(NativeLogger);
  app.useLogger(logger);

  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === "production" ? undefined : false,
    }),
  );

  const webUrl = process.env.WEB_URL || "http://localhost:3001";
  const adminUrl = process.env.ADMIN_URL || "http://localhost:3002";
  const isProduction = process.env.NODE_ENV === "production";
  const allowedOrigins = new Set([webUrl, adminUrl]);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (
        !origin ||
        allowedOrigins.has(origin) ||
        (!isProduction &&
          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  });

  app.use(
    json({
      limit: "10mb",
      verify: (req: RawBodyRequest, _res, buf) => {
        if (req.url.startsWith("/api/webhooks")) {
          req.rawBody = buf.toString();
        }
      },
    }),
  );

  app.setGlobalPrefix("api");

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(app.get(IdempotencyInterceptor));

  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost, logger));

  const config = new DocumentBuilder()
    .setTitle("TrustPay API")
    .setDescription("TrustPay fintech API documentation")
    .setVersion("1.0")
    .addBearerAuth()
    .addTag("auth", "Authentication endpoints")
    .addTag("users", "User management")
    .addTag("wallets", "Wallet operations")
    .addTag("exchange", "Currency exchange")
    .addTag("payments", "Payment gateway")
    .addTag("banking", "Virtual accounts and banking readiness")
    .addTag("transfers", "Internal wallet transfers")
    .addTag("vtu", "VTU and bill payments")
    .addTag("admin", "Admin operations")
    .build();

  if (!isProduction || process.env.ENABLE_SWAGGER === "true") {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document, {
      swaggerOptions: { persistAuthorization: !isProduction },
    });
  }

  const port = process.env.PORT ?? 3000;
  const server = (await app.listen(port)) as Server;
  logger.log(`Application started on port ${port}`);
  if (!isProduction || process.env.ENABLE_SWAGGER === "true") {
    logger.log(`API docs available at http://localhost:${port}/api/docs`);
  }

  const gracefulShutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down gracefully`);
    await Sentry.close(2000);
    server.close(() => {
      logger.log("HTTP server closed");
      void app.close().then(() => process.exit(0));
    });

    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
}
void bootstrap();
