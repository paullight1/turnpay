import { json, raw } from 'body-parser';
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

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
    '/api/webhooks',
    raw({ type: 'application/json' }),
  );

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

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  app.get(PinoLogger).info(`Application started on port ${port}`);
}
bootstrap();
