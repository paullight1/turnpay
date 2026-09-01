import { Test } from '@nestjs/testing';
import { ExchangeController, AdminExchangeController } from '../src/exchange/exchange.controller';
import { ExchangeService } from '../src/exchange/exchange.service';
import { RateService } from '../src/exchange/providers/rate.service';
import { RateAlertService, NotificationService } from '../src/exchange/providers/rate-alert.service';
import { RedisService } from '../src/redis/redis.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PinoLogger } from 'nestjs-pino';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ExchangeController, AdminExchangeController],
    providers: [
      {provide: ExchangeService, useValue: {}},
      {provide: RateService, useValue: {}},
      {provide: RateAlertService, useValue: {}},
      {provide: NotificationService, useValue: {}},
      {provide: RedisService, useValue: {isAvailable:()=>false}},
      {provide: PrismaService, useValue: {}},
      {provide: PinoLogger, useValue: {info(){},warn(){},error(){},debug(){},trace(){},fatal(){}}},
    ],
  }).overrideGuard(JwtAuthGuard).useValue({canActivate: ()=>true}).compile();

  const app:any = moduleRef.createNestApplication();
  await app.init();
  const server:any = app.getHttpServer();
  console.log('server is defined', !!server);
  console.log('server type', server?.constructor?.name);
  try {
    console.log('address', server?.address ? server.address() : 'no address func');
  } catch (error:any) {
    console.error('address error', error.message);
  }
  await app.close();
})();
