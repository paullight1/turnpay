import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CircuitBreakerService } from '../common/services/circuit-breaker.service';

type Envelope<T> = {
  status: boolean;
  data?: T;
  meta?: { next?: string | null };
};

type PaystackHttpFailureCause = {
  providerStatusCode?: number;
};

/** The only Paystack HTTP boundary. Never return/log upstream errors containing PII. */
@Injectable()
export class PaystackClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly circuit: CircuitBreakerService,
  ) {}

  get configured() {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim() ?? '';
    return (
      /^sk_(test|live)_[A-Za-z0-9]+$/.test(key) &&
      (this.config.get<string>('NODE_ENV') !== 'production' ||
        key.startsWith('sk_live_'))
    );
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    return (await this.fetch<T>(method, path, data, params)).data ?? ({} as T);
  }

  async page<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<{ data: T[]; meta?: { next?: string | null } }> {
    const response = await this.fetch<T[]>('GET', path, undefined, params);
    return { data: response.data ?? [], meta: response.meta };
  }

  private async fetch<T>(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
    params?: Record<string, string>,
  ): Promise<Envelope<T>> {
    if (!this.configured)
      throw new ServiceUnavailableException('Paystack is not configured');
    if (!/^\/[a-z_]+(?:\/[A-Za-z0-9_@.%+=-]+)*$/.test(path))
      throw new BadRequestException('Invalid provider request');
    const circuit = `paystack:${path.split('/')[1]}`;
    if (!(await this.circuit.canExecute(circuit)))
      throw new ServiceUnavailableException(
        'Paystack is temporarily unavailable',
      );
    try {
      const response = await firstValueFrom(
        this.http.request<Envelope<T>>({
          method,
          url: `https://api.paystack.co${path}`,
          data,
          params,
          timeout: 15000,
          maxRedirects: 0,
          headers: {
            Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')!.trim()}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      if (response.data.status !== true)
        throw this.providerBadRequest(response.status);
      await this.circuit.recordSuccess(circuit);
      return response.data;
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      if (
        isAxiosError(error) &&
        [400, 401, 402, 403, 404, 409, 422, 429].includes(
          error.response?.status ?? 0,
        )
      ) {
        throw this.providerBadRequest(error.response?.status);
      }
      await this.circuit.recordFailure(circuit);
      throw new ServiceUnavailableException(
        'Paystack confirmation is unavailable. Refresh the status before trying again.',
      );
    }
  }

  /**
   * Keep the upstream status available to provider-specific callers without
   * returning provider payloads or PII through the API exception response.
   */
  private providerBadRequest(providerStatusCode?: number) {
    const cause: PaystackHttpFailureCause | undefined =
      typeof providerStatusCode === 'number'
        ? { providerStatusCode }
        : undefined;
    return new BadRequestException(
      'Paystack could not complete this request. Check the details or contact support.',
      cause ? { cause } : undefined,
    );
  }

  async ensureCustomer(
    userId: string,
  ): Promise<{ customerCode: string; customerId: string }> {
    const existing = await this.prisma.paystackCustomer.findUnique({
      where: { userId },
    });
    if (existing)
      return {
        customerCode: existing.customerCode,
        customerId: existing.customerId ?? '',
      };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, fullName: true, phone: true, isSuspended: true },
    });
    const [firstName, ...last] = (user?.fullName ?? '').trim().split(/\s+/);
    if (!user || user.isSuspended || !firstName || !last.length || !user.phone)
      throw new BadRequestException(
        'Complete your legal name and phone number before continuing',
      );
    let customer: {
      customer_code: string;
      id: number | string;
      email?: string;
    };
    try {
      customer = await this.request('POST', '/customer', {
        email: user.email,
        first_name: firstName,
        last_name: last.join(' '),
        phone: user.phone,
      });
    } catch (creationError) {
      // A lost creation response must not strand the identity or create a second customer.
      try {
        customer = await this.request(
          'GET',
          `/customer/${encodeURIComponent(user.email)}`,
        );
      } catch {
        throw creationError;
      }
    }
    if (
      customer.email &&
      customer.email.toLowerCase() !== user.email.toLowerCase()
    )
      throw new ServiceUnavailableException(
        'Paystack customer identity could not be confirmed',
      );
    if (!/^CUS_[a-zA-Z0-9]+$/.test(customer.customer_code ?? ''))
      throw new ServiceUnavailableException(
        'Paystack did not return a customer identity',
      );
    const binding = await this.prisma.paystackCustomer.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        customerCode: customer.customer_code,
        customerId: String(customer.id),
      },
    });
    return {
      customerCode: binding.customerCode,
      customerId: binding.customerId ?? '',
    };
  }
}
