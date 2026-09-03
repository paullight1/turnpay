import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { VtuService } from './vtu.service';
import { VtuWebhookInboxService } from './vtu-webhook-inbox.service';

@Injectable()
export class VtuWebhookProcessorService {
  constructor(
    private readonly inbox: VtuWebhookInboxService,
    private readonly vtuService: VtuService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingCallbacks() {
    try {
      const result = await this.inbox.retryPending(
        (event) => this.vtuService.processVtpassWebhookEvent(event),
        25,
      );
      if (result.checked > 0) {
        this.logger.info(result, 'VTpass webhook inbox retry completed');
      }
    } catch (error) {
      this.logger.error(
        {
          errorMessage:
            error instanceof Error ? error.message : 'Unknown inbox error',
        },
        'VTpass webhook inbox retry failed',
      );
    }
  }
}
