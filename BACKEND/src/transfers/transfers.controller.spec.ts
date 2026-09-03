import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { AuthenticatedUserThrottlerGuard } from '../common/guards/authenticated-user-throttler.guard';
import { InternalTransfersAvailabilityGuard } from './guards/internal-transfers-availability.guard';
import { TransfersController } from './transfers.controller';

describe('TransfersController release gating', () => {
  const methodGuards = (method: keyof TransfersController) =>
    (Reflect.getMetadata(
      GUARDS_METADATA,
      TransfersController.prototype[method],
    ) ?? []) as unknown[];
  const methodHttpCode = (method: keyof TransfersController) =>
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      TransfersController.prototype[method],
    ) as number | undefined;

  it('gates only the internal-transfer mutation behind the release switch', () => {
    expect(methodGuards('sendInternalTransfer')).toContain(
      InternalTransfersAvailabilityGuard,
    );
    expect(methodGuards('sendInternalTransfer')).toContain(
      AuthenticatedUserThrottlerGuard,
    );
    expect(methodGuards('previewRecipient')).not.toContain(
      InternalTransfersAvailabilityGuard,
    );
    expect(methodGuards('previewRecipient')).toContain(
      AuthenticatedUserThrottlerGuard,
    );
    expect(methodHttpCode('previewRecipient')).toBe(200);
    expect(methodGuards('getInternalTransfer')).not.toContain(
      InternalTransfersAvailabilityGuard,
    );
  });

  it('passes bounded request audit and idempotency context to the service', async () => {
    const transfersService = {
      sendInternalTransfer: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
    };
    const controller = new TransfersController(transfersService as never);
    const dto = {
      recipientEmail: 'recipient@example.com',
      amount: '12.34',
      currency: 'NGN' as const,
      transactionPin: '1234',
    };
    const request = {
      id: 'request-7',
      ip: '203.0.113.8',
      get: (header: string) =>
        header === 'user-agent' ? 'a'.repeat(300) : undefined,
    };

    await (controller.sendInternalTransfer as any)(
      { userId: 'sender-1' },
      dto,
      'transfer-key-1',
      request,
    );

    expect(transfersService.sendInternalTransfer).toHaveBeenCalledWith(
      'sender-1',
      dto,
      {
        idempotencyKey: 'transfer-key-1',
        requestId: 'request-7',
        ipAddress: '203.0.113.8',
        userAgent: 'a'.repeat(256),
      },
    );
  });
});
