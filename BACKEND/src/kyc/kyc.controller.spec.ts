import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { KycController, KycWebhookController } from './kyc.controller';
import {
  CreateIdentityVerificationDto,
  YouverifyWebhookDto,
} from './dto/kyc.dto';

describe('KYC controllers', () => {
  const kycService = {
    verifyIdentity: jest.fn(),
    verifyWithYouverify: jest.fn(),
    processYouverifyCallback: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes authenticated direct-verification requests to the KYC service', async () => {
    const controller = new KycController(kycService as any);
    const dto: CreateIdentityVerificationDto = {
      country: 'NG',
      type: 'BVN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      consentAccepted: true,
    };
    kycService.verifyIdentity.mockResolvedValue({
      provider: 'NINJA',
      status: 'VERIFIED',
    });

    await controller.verifyIdentity({ userId: 'user-1' }, dto);

    expect(kycService.verifyIdentity).toHaveBeenCalledWith('user-1', dto);
  });

  it('forwards the raw webhook body and Youverify signature to verification', async () => {
    const controller = new KycWebhookController(kycService as any);
    const body = {
      event: 'identity.completed',
      apiVersion: 'v2',
      data: { id: 'verification-1', status: 'found' },
    };
    kycService.processYouverifyCallback.mockResolvedValue({ received: true });

    await controller.handleYouverifyWebhook(
      'signature-value',
      { rawBody: JSON.stringify(body) } as any,
      body,
    );

    expect(kycService.processYouverifyCallback).toHaveBeenCalledWith({
      body,
      rawBody: JSON.stringify(body),
      signatureHeader: 'signature-value',
    });
  });

  it('rejects direct verification without explicit consent', async () => {
    const dto = plainToInstance(CreateIdentityVerificationDto, {
      country: 'NG',
      type: 'NIN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      consentAccepted: false,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'consentAccepted')).toBe(
      true,
    );
  });

  it.each([
    [{ country: 'GH', type: 'NIN', dateOfBirth: '1990-01-02' }, 'country'],
    [
      { country: 'NG', type: 'DRIVERS_LICENSE', dateOfBirth: '1990-01-02' },
      'type',
    ],
    [{ country: 'NG', type: 'NIN', dateOfBirth: '1990-02-31' }, 'dateOfBirth'],
  ])(
    'rejects unsupported direct-verification input %o',
    async (input, field) => {
      const dto = plainToInstance(CreateIdentityVerificationDto, {
        ...input,
        idNumber: '12345678901',
        consentAccepted: true,
      });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );

  it('rejects malformed Youverify webhook envelopes', async () => {
    const dto = plainToInstance(YouverifyWebhookDto, {
      event: '',
      data: 'not-an-object',
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['event', 'apiVersion', 'data']),
    );
  });
});
