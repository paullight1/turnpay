import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExchangeService } from './exchange.service';
import { ExchangeController } from './exchange.controller';
import { RateService } from './providers/rate.service';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    UsersModule,
    WalletsModule,
  ],
  controllers: [ExchangeController],
  providers: [ExchangeService, RateService],
  exports: [ExchangeService, RateService],
})
export class ExchangeModule {}
