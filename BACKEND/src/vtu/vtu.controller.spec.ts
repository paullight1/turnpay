import { VtuController } from './vtu.controller';

describe('VtuController', () => {
  const vtuService = {
    getProviders: jest.fn(),
    validateSmartCard: jest.fn(),
    validateMeter: jest.fn(),
  };

  let controller: VtuController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new VtuController(vtuService as any);
  });

  it('delegates provider queries to the VTpass-backed service', async () => {
    vtuService.getProviders.mockResolvedValue([
      { id: 'mtn', name: 'MTN', type: 'airtime', isActive: true },
    ]);

    await expect(controller.getProviders({ type: 'airtime' })).resolves.toEqual(
      [{ id: 'mtn', name: 'MTN', type: 'airtime', isActive: true }],
    );
    expect(vtuService.getProviders).toHaveBeenCalledWith('airtime');
  });

  it('delegates smart-card validation using the validated body', async () => {
    const dto = {
      provider: 'dstv' as const,
      smartCardNumber: '1212121212',
      subscriptionType: 'change' as const,
      contactPhone: '+2348031234567',
    };
    vtuService.validateSmartCard.mockResolvedValue({
      name: 'Ada',
      status: 'active',
    });

    await expect(controller.validateSmartCard(dto)).resolves.toEqual({
      name: 'Ada',
      status: 'active',
    });
    expect(vtuService.validateSmartCard).toHaveBeenCalledWith(dto);
  });

  it('delegates meter validation using the validated body', async () => {
    const dto = {
      provider: 'ikedc' as const,
      meterNumber: '1111111111111',
      meterType: 'prepaid' as const,
      contactPhone: '+2348031234567',
    };
    vtuService.validateMeter.mockResolvedValue({
      name: 'Ada',
      address: 'Lagos',
    });

    await expect(controller.validateMeter(dto)).resolves.toEqual({
      name: 'Ada',
      address: 'Lagos',
    });
    expect(vtuService.validateMeter).toHaveBeenCalledWith(dto);
  });
});
