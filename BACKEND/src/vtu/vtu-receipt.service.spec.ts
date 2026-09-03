import { BadRequestException } from '@nestjs/common';
import { VtuReceiptService } from './vtu-receipt.service';

describe('VtuReceiptService', () => {
  const config = {
    get: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue('test-pii-key-with-at-least-32-characters');
  });

  it('encrypts purchased codes and only exposes plaintext in an owner receipt', () => {
    const service = new VtuReceiptService(config as any);
    const encrypted = service.encryptPurchasedCode('1234-5678-9012-3456-7890');

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain('1234-5678-9012-3456-7890');
    expect(service.toOwnerReceipt(encrypted)).toEqual({
      purchasedCode: '1234-5678-9012-3456-7890',
    });
  });

  it('returns no purchased code when a product has no vend token', () => {
    const service = new VtuReceiptService(config as any);

    expect(service.encryptPurchasedCode(undefined)).toBeUndefined();
    expect(service.toOwnerReceipt(null)).toEqual({});
  });

  it('fails closed when the PII encryption key is unavailable', () => {
    config.get.mockReturnValue(undefined);
    const service = new VtuReceiptService(config as any);

    expect(() => service.encryptPurchasedCode('1234-5678')).toThrow(
      BadRequestException,
    );
  });
});
