import { Injectable } from '@nestjs/common';
import type { InternalTransferResponse } from './internal-transfer-idempotency.service';

export class TransferPostCommitFault extends Error {
  constructor(message = 'Injected post-commit transfer fault') {
    super(message);
    this.name = 'TransferPostCommitFault';
  }
}

@Injectable()
export class TransferPostCommitHook {
  afterCommit(response: InternalTransferResponse): Promise<void> {
    void response;
    // Production no-op. Financial fault tests override this provider to model
    // process loss after the database commit and before the HTTP response.
    return Promise.resolve();
  }
}
