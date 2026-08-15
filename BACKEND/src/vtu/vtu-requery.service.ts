import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { VtuService } from './vtu.service';

@Injectable()
export class VtuRequeryService {
  constructor(
    private readonly vtuService: VtuService,
    private readonly pinoLogger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async requeryPendingOrders() {
    try {
      const result = await this.vtuService.requeryPendingOrders(25);

      if (result.checked > 0) {
        this.pinoLogger.info(
          {
            checked: result.checked,
            processed: result.results.filter((item) => item.processed).length,
          },
          'VTU pending order requery completed',
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown VTU requery error';

      this.pinoLogger.error(
        { errorMessage },
        'VTU pending order requery failed',
      );
    }
  }
}
