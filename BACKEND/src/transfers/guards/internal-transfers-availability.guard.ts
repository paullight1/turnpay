import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalTransfersAvailabilityGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const enabled = this.configService.get<boolean>(
      'INTERNAL_TRANSFERS_ENABLED',
      false,
    );

    if (enabled !== true) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'INTERNAL_TRANSFERS_UNAVAILABLE',
        message: 'Internal transfers are temporarily unavailable',
      });
    }

    return true;
  }
}
