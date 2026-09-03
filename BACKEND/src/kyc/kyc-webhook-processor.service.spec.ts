import { KycWebhookProcessorService } from './kyc-webhook-processor.service';

describe('KycWebhookProcessorService', () => {
  const inbox = {
    findDueEvents: jest.fn(),
    claim: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
    recoverStaleClaims: jest.fn(),
  };
  const kycService = { applyYouverifyCallback: jest.fn() };
  const logger = { error: jest.fn() };
  let service: KycWebhookProcessorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KycWebhookProcessorService(
      inbox as any,
      kycService as any,
      logger as any,
    );
  });

  it('claims and applies a normalized Youverify callback before completing it', async () => {
    const payload = {
      provider: 'YOUVERIFY',
      status: 'VERIFIED',
      reference: 'verification-1',
      checks: { providerStatus: 'found', allValidationPassed: true },
      responseHash: 'response-hash',
      documentType: 'NIN',
      country: 'NG',
    };
    inbox.findDueEvents.mockResolvedValue([
      {
        id: 'event-1',
        provider: 'YOUVERIFY',
        eventType: 'identity.completed',
        providerReference: 'verification-1',
        payload,
      },
    ]);
    inbox.claim.mockResolvedValue(true);
    kycService.applyYouverifyCallback.mockResolvedValue({
      duplicate: false,
      status: 'VERIFIED',
    });

    await service.processDueEvents(10);

    expect(kycService.applyYouverifyCallback).toHaveBeenCalledWith(payload);
    expect(inbox.complete).toHaveBeenCalledWith('event-1');
  });

  it('records a bounded retry when callback application fails', async () => {
    inbox.findDueEvents.mockResolvedValue([
      {
        id: 'event-2',
        provider: 'YOUVERIFY',
        eventType: 'identity.completed',
        providerReference: 'verification-2',
        payload: {
          provider: 'YOUVERIFY',
          status: 'VERIFIED',
          reference: 'verification-2',
          checks: {},
          responseHash: 'response-hash-2',
        },
      },
    ]);
    inbox.claim.mockResolvedValue(true);
    kycService.applyYouverifyCallback.mockRejectedValue(
      new Error('database unavailable'),
    );

    await service.processDueEvents(10);

    expect(inbox.fail).toHaveBeenCalledWith('event-2', 'database unavailable');
  });
});
