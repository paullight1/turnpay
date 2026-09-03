import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  PurchaseVtuDto,
  ValidateMeterDto,
  ValidateSmartCardDto,
} from './vtu.dto';

async function validateInput<T extends object>(
  type: new () => T,
  input: Record<string, unknown>,
) {
  const instance = plainToInstance(type, input);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { instance, errors };
}

describe('VTU DTO contract', () => {
  it('normalizes Nigerian phone numbers before validating a purchase', async () => {
    const { instance, errors } = await validateInput(PurchaseVtuDto, {
      type: 'electricity',
      provider: 'ikedc',
      contactPhone: '08031234567',
      meterNumber: '1111111111111',
      meterType: 'prepaid',
      amount: '1000.00',
      transactionPin: '2468',
    });

    expect(errors).toHaveLength(0);
    expect(instance.contactPhone).toBe('+2348031234567');
  });

  it('rejects legacy international routing fields', async () => {
    const { errors } = await validateInput(PurchaseVtuDto, {
      type: 'airtime',
      provider: 'mtn',
      contactPhone: '+2348031234567',
      recipientNumber: '+2348031234567',
      amount: '100.00',
      transactionPin: '2468',
      scope: 'international',
    });

    expect(errors.some((error) => error.property === 'scope')).toBe(true);
  });

  it('requires a package when changing a cable bouquet', async () => {
    const { errors } = await validateInput(PurchaseVtuDto, {
      type: 'cable',
      provider: 'dstv',
      contactPhone: '+2348031234567',
      smartCardNumber: '1212121212',
      subscriptionType: 'change',
      amount: '6500.00',
      transactionPin: '2468',
    });

    expect(errors.some((error) => error.property === 'packageId')).toBe(true);
  });

  it('requires prepaid or postpaid meter type for electricity', async () => {
    const { errors } = await validateInput(PurchaseVtuDto, {
      type: 'electricity',
      provider: 'ikedc',
      contactPhone: '+2348031234567',
      meterNumber: '1111111111111',
      amount: '1000.00',
      transactionPin: '2468',
    });

    expect(errors.some((error) => error.property === 'meterType')).toBe(true);
  });

  it('validates smart-card lookups from a bounded request body', async () => {
    const { instance, errors } = await validateInput(ValidateSmartCardDto, {
      provider: 'dstv',
      smartCardNumber: '1212121212',
      subscriptionType: 'renew',
      contactPhone: '08031234567',
    });

    expect(errors).toHaveLength(0);
    expect(instance.contactPhone).toBe('+2348031234567');
  });

  it('validates meter lookups with the same meter type used for purchase', async () => {
    const { errors } = await validateInput(ValidateMeterDto, {
      provider: 'ikedc',
      meterNumber: '1111111111111',
      meterType: 'postpaid',
      contactPhone: '+2348031234567',
    });

    expect(errors).toHaveLength(0);
  });
});
