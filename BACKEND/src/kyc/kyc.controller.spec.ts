import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { KycController } from './kyc.controller';
import {
  CreateIdentityVerificationDto,
  ReconcilePaystackKycDto,
} from './dto/kyc.dto';

describe('KYC controllers', () => {
  const kycService = {
    verifyIdentity: jest.fn(),
    createManualKycDocument: jest.fn(),
  };

  const recovery = { reconcile: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes authenticated direct-verification requests to the KYC service', async () => {
    const controller = new KycController(kycService as any, recovery as any);
    const dto: CreateIdentityVerificationDto = {
      country: 'NG',
      type: 'BVN',
      idNumber: '12345678901',
      dateOfBirth: '1990-01-02',
      consentAccepted: true,
    };
    kycService.verifyIdentity.mockResolvedValue({
      provider: 'MONNIFY',
      status: 'VERIFIED',
    });

    await controller.verifyIdentity({ userId: 'user-1' }, dto);

    expect(kycService.verifyIdentity).toHaveBeenCalledWith('user-1', dto);
  });

  it('passes owned manual NIN submissions to the KYC service', async () => {
    const controller = new KycController(kycService as any, recovery as any);
    const dto = {
      type: 'NIN' as const,
      idNumber: '12345678901',
      objectKey: 'kyc/user-1/nin.pdf',
      consentAccepted: true as const,
    };

    await controller.createManualKycDocument({ userId: 'user-1' }, dto);

    expect(kycService.createManualKycDocument).toHaveBeenCalledWith(
      'user-1',
      dto,
    );
  });

  it('reconciles only the authenticated customer and rejects caller-supplied identity fields', async () => {
    const controller = new KycController(kycService as any, recovery as any);
    recovery.reconcile.mockResolvedValue({ state: 'AWAITING_PROVIDER' });
    await expect(
      controller.reconcilePaystack({ userId: 'user-1' }, {}),
    ).resolves.toEqual({ state: 'AWAITING_PROVIDER' });
    expect(recovery.reconcile).toHaveBeenCalledWith('user-1');
    const errors = await validate(
      plainToInstance(ReconcilePaystackKycDto, {
        customerCode: 'foreign-customer',
        userId: 'other-user',
        action: 'approve',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors.map((error) => error.property).sort()).toEqual([
      'action',
      'customerCode',
      'userId',
    ]);
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
});
