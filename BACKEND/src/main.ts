import { json } from 'body-parser';
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(PinoLogger));

  app.use(helmet());

  const webUrl = process.env.WEB_URL;
  const adminUrl = process.env.ADMIN_URL;

  if (!webUrl || !adminUrl) {
    throw new Error('WEB_URL and ADMIN_URL environment variables are required');
  }

  app.enableCors({
    origin: [webUrl, adminUrl],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(app.get(IdempotencyInterceptor));

  app.use(
    json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        if (req.url.startsWith('/api/webhooks')) {
          req.rawBody = buf.toString();
        }
      },
    }),
  );

  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new AllExceptionsFilter(httpAdapterHost, app.get(PinoLogger)),
  );

  const config = new DocumentBuilder()
    .setTitle('TrustPay API')
    .setDescription('TrustPay fintech API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management')
    .addTag('wallets', 'Wallet operations')
    .addTag('exchange', 'Currency exchange')
    .addTag('payments', 'Payment gateway')
    .addTag('vtu', 'VTU and bill payments')
    .addTag('admin', 'Admin operations')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3000;
  const server = await app.listen(port);
  app.get(PinoLogger).info(`Application started on port ${port}`);
  app
    .get(PinoLogger)
    .info(`API docs available at http://localhost:${port}/api/docs`);

  const gracefulShutdown = async (signal: string) => {
    app.get(PinoLogger).info(`${signal} received, shutting down gracefully`);
    await Sentry.close(2000);
    server.close(async () => {
      app.get(PinoLogger).info('HTTP server closed');
      await app.close();
      process.exit(0);
    });

    setTimeout(() => {
      app.get(PinoLogger).error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
bootstrap();
