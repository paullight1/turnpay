import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { createHmac, timingSafeEqual } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { CircuitBreakerService } from '../common/services/circuit-breaker.service';

export type KoraRecord = Record<string, unknown>;
export function asRecord(value: unknown): KoraRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as KoraRecord)
    : {};
}
export function providerText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function parseKoraMoney(value: unknown): Decimal {
  const text =
    typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(text))
    throw new BadRequestException('Invalid provider amount');
  const amount = new Decimal(text);
  if (amount.lte(0) || amount.gt('10000000'))
    throw new BadRequestException('Invalid provider amount');
  return amount;
}
/** Emit exact major-unit JSON numbers without converting money through binary arithmetic. */
export function encodeKoraPayload(value: unknown): string {
  if (Decimal.isDecimal(value))
    return parseKoraMoney(value.toFixed()).toFixed(2);
  if (Array.isArray(value))
    return `[${value.map(encodeKoraPayload).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${encodeKoraPayload(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function verifyKoraSignature(
  data: unknown,
  signature: string,
  secret: string,
): boolean {
  if (
    !secret ||
    typeof signature !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(signature) ||
    !data ||
    typeof data !== 'object'
  )
    return false;
  const expected = createHmac('sha256', secret)
    .update(JSON.stringify(data))
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

@Injectable()
export class KoraClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly circuit: CircuitBreakerService,
  ) {}
  async request<T = KoraRecord>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    const secret = this.config.get<string>('KORA_SECRET_KEY', '').trim();
    if (
      !/^sk_(test|live)_[A-Za-z0-9_-]+$/.test(secret) ||
      (this.config.get('NODE_ENV') === 'production' &&
        !secret.startsWith('sk_live_'))
    )
      throw new ServiceUnavailableException('Kora is not configured');
    if (
      !/^\/[a-z][a-z0-9-]*(?:\/[A-Za-z0-9_%.-]+)*$/.test(path) ||
      path.includes('..')
    )
      throw new BadRequestException('Invalid provider request');
    const scope = `kora:${path.split('/')[1]}`;
    if (!(await this.circuit.canExecute(scope)))
      throw new ServiceUnavailableException(
        'Ghana payments are temporarily unavailable',
      );
    try {
      const response = await firstValueFrom(
        this.http.request<{ status: boolean; data: T }>({
          method,
          url: `https://api.korapay.com/merchant/api/v1${path}`,
          params: query,
          data: body === undefined ? undefined : encodeKoraPayload(body),
          timeout: 15000,
          maxRedirects: 0,
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      if (response.data.status !== true || response.data.data === undefined)
        throw new Error('Unconfirmed provider response');
      await this.circuit.recordSuccess(scope);
      return response.data.data;
    } catch {
      await this.circuit.recordFailure(scope);
      // Never expose HTTP error objects or assume a rejected response means no transfer exists.
      throw new ServiceUnavailableException(
        'Check this payment status before trying again. Provider confirmation is unavailable.',
      );
    }
  }
}
