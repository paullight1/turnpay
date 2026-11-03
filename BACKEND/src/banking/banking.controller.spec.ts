import { BadRequestException } from '@nestjs/common';
import { BankingController } from './banking.controller';

describe('Receiving account HTTP attempts', () => {
  const key = '9e2456a5-8744-43ce-8888-731b63612a99';
  const banking = {
    requestAccountSetup: jest.fn().mockResolvedValue({ status: 'PENDING' }),
    provisionVirtualAccount: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
  };
  const controller = new BankingController(banking as never, {} as never);
  beforeEach(() => jest.clearAllMocks());
  it('requires an attempt key before saving consent', () => {
    expect(() =>
      controller.requestAccountSetup(
        { userId: 'owner' },
        { consentAccepted: true },
      ),
    ).toThrow(BadRequestException);
    expect(banking.requestAccountSetup).not.toHaveBeenCalled();
  });
  it('accepts the legacy header for account requests', async () => {
    await controller.requestAccountSetup(
      { userId: 'owner' },
      { consentAccepted: true },
      undefined,
      key,
    );
    expect(banking.requestAccountSetup).toHaveBeenCalledWith('owner', {
      consentAccepted: true,
    });
  });
  it('requires an attempt key before requesting a bank account', async () => {
    await expect(
      controller.provisionVirtualAccount(
        { userId: 'owner' },
        { currency: 'NGN' },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(banking.provisionVirtualAccount).not.toHaveBeenCalled();
  });
  it('passes the legacy attempt key through to provisioning', async () => {
    await controller.provisionVirtualAccount(
      { userId: 'owner' },
      { currency: 'NGN' },
      undefined,
      undefined,
      key,
    );
    expect(banking.provisionVirtualAccount).toHaveBeenCalledWith(
      'owner',
      { currency: 'NGN' },
      key,
    );
  });
});
