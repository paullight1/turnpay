import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VtuService } from './vtu.service';
import { VtuController } from './vtu.controller';
import { VtuApiProvider } from './providers/vtu-api.provider';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5,
    }),
    WalletsModule,
  ],
  controllers: [VtuController],
  providers: [VtuService, VtuApiProvider],
  exports: [VtuService],
})
export class VtuModule {}
