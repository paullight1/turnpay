import { VtuWebhookProcessorService } from './vtu-webhook-processor.service';

describe('VtuWebhookProcessorService', () => {
  it('retries due inbox events through the guarded VTU settlement path', async () => {
    const inbox = { retryPending: jest.fn().mockResolvedValue({ checked: 1 }) };
    const vtuService = {
      processVtpassWebhookEvent: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { info: jest.fn(), error: jest.fn() };
    const service = new VtuWebhookProcessorService(
      inbox as any,
      vtuService as any,
      logger as any,
    );

    await service.processPendingCallbacks();

    const processor = inbox.retryPending.mock.calls[0][0];
    const event = {
      eventType: 'transaction-update',
      providerRequestId: 'REQ-1',
      status: 'success',
    } as const;
    await processor(event);
    expect(vtuService.processVtpassWebhookEvent).toHaveBeenCalledWith(event);
  });
});
