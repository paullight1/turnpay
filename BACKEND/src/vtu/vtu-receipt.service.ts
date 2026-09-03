import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '../common/utils/encryption';

const ENCRYPTED_PREFIX = 'enc:v1:';

@Injectable()
export class VtuReceiptService {
  constructor(private readonly configService: ConfigService) {}

  encryptPurchasedCode(value?: string) {
    const code = value?.trim();
    if (!code) return undefined;

    return `${ENCRYPTED_PREFIX}${encryptSensitiveValue(
      code,
      this.configService.get<string>('PII_ENCRYPTION_KEY'),
    )}`;
  }

  decryptPurchasedCode(value?: string | null) {
    if (!value) return undefined;
    if (!value.startsWith(ENCRYPTED_PREFIX)) return undefined;

    return decryptSensitiveValue(
      value.slice(ENCRYPTED_PREFIX.length),
      this.configService.get<string>('PII_ENCRYPTION_KEY'),
    );
  }

  toOwnerReceipt(value?: string | null) {
    const purchasedCode = this.decryptPurchasedCode(value);
    return purchasedCode ? { purchasedCode } : {};
  }
}
