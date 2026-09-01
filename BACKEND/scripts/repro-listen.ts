import { Test } from '@nestjs/testing';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';

(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AppController],
    providers: [AppService],
  }).compile();

  const app:any = moduleRef.createNestApplication();
  await app.init();
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    console.log('address', address);
  } catch (err:any) {
    console.error('listen error', err.message);
  }
  await app.close();
})();
