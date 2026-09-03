import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type IdempotencyEncryptionContext = {
  route: string;
  scope: string;
  keyDigest: string;
};

export type EncryptedIdempotencyResponse = {
  responseCiphertext: string;
  responseIv: string;
  responseTag: string;
  encryptionKeyId: string;
};

@Injectable()
export class IdempotencyResponseCryptoService {
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(private readonly config: ConfigService) {
    const configuredKey = this.config.get<string>(
      'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY',
    );
    const environment = this.config.get<string>('NODE_ENV', 'development');
    if (!configuredKey) {
      if (environment === 'production' || environment === 'staging') {
        throw new Error(
          'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY is required in deployed environments',
        );
      }
      this.key = randomBytes(32);
      this.keyId = 'ephemeral-development';
      return;
    }

    this.key = Buffer.from(configuredKey, 'base64');
    if (this.key.length !== 32) {
      throw new Error(
        'IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY must decode to exactly 32 bytes',
      );
    }

    this.keyId =
      this.config
        .get<string>('IDEMPOTENCY_RESPONSE_ENCRYPTION_KEY_ID')
        ?.trim() || 'v1';
  }

  encrypt(
    response: unknown,
    context: IdempotencyEncryptionContext,
  ): EncryptedIdempotencyResponse {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.additionalAuthenticatedData(context));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(response), 'utf8'),
      cipher.final(),
    ]);

    return {
      responseCiphertext: ciphertext.toString('base64url'),
      responseIv: iv.toString('base64url'),
      responseTag: cipher.getAuthTag().toString('base64url'),
      encryptionKeyId: this.keyId,
    };
  }

  decrypt(
    encrypted: EncryptedIdempotencyResponse,
    context: IdempotencyEncryptionContext,
  ) {
    if (encrypted.encryptionKeyId !== this.keyId) {
      throw new Error(
        `Idempotency response key ${encrypted.encryptionKeyId} is unavailable`,
      );
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(encrypted.responseIv, 'base64url'),
    );
    decipher.setAAD(this.additionalAuthenticatedData(context));
    decipher.setAuthTag(Buffer.from(encrypted.responseTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.responseCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    return JSON.parse(plaintext) as unknown;
  }

  private additionalAuthenticatedData(context: IdempotencyEncryptionContext) {
    return Buffer.from(
      JSON.stringify({
        route: context.route,
        scope: context.scope,
        keyDigest: context.keyDigest,
      }),
      'utf8',
    );
  }
}
