import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Registration uses its own Redis bucket so general API traffic cannot
 * consume the account-creation allowance. */
@Injectable()
export class RegistrationThrottlerGuard extends ThrottlerGuard {
  async onModuleInit() {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter(
      ({ name }) => name === 'registration',
    );
  }
}
