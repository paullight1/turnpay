import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import { VtuProviderHealth } from './provider-health.types';
import { CircuitBreakerService } from '../../common/services/circuit-breaker.service';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  NormalizedVtuStatus,
  VtuPackage,
  VtuProviderPurchase,
  VtuProviderResult,
} from './vtpass.types';
import type { VtuMeterType } from '../dto/vtu.dto';

export interface VtuProvider {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export type { VtuPackage, VtuProviderResult } from './vtpass.types';

type VtuServiceType = 'airtime' | 'data' | 'cable' | 'electricity';

interface VtpassServiceDefinition {
  id: string;
  name: string;
  type: VtuServiceType;
  serviceID: string;
  isActive: boolean;
}

interface VtpassVariation {
  variation_code?: string;
  name?: string;
  variation_amount?: string;
}

interface VtpassResponse {
  code?: string;
  response_description?: string;
  requestId?: string;
  content?: {
    variations?: VtpassVariation[];
    varations?: VtpassVariation[];
    transactions?: {
      status?: string;
      transactionId?: string;
      total_amount?: string | number;
      commission?: string | number;
    };
  };
  purchased_code?: string;
}

interface VtpassBalanceResponse {
  code?: number | string;
  contents?: {
    balance?: number | string;
  };
}

interface VtpassMerchantVerifyResponse {
  code?: number | string;
  response_description?: string;
  content?: {
    error?: string;
    Customer_Name?: string;
    Address?: string;
    Status?: string;
    Customer_Number?: string;
    Meter_Number?: string;
    Customer_Type?: string;
    Can_Vend?: string;
    Renewal_Amount?: string | number;
  };
}

const VTPASS_SERVICES: VtpassServiceDefinition[] = [
  { id: 'mtn', name: 'MTN', type: 'airtime', serviceID: 'mtn', isActive: true },
  {
    id: 'airtel',
    name: 'Airtel',
    type: 'airtime',
    serviceID: 'airtel',
    isActive: true,
  },
  { id: 'glo', name: 'Glo', type: 'airtime', serviceID: 'glo', isActive: true },
  {
    id: '9mobile',
    name: '9mobile',
    type: 'airtime',
    serviceID: 'etisalat',
    isActive: true,
  },
  {
    id: 'mtn',
    name: 'MTN Data',
    type: 'data',
    serviceID: 'mtn-data',
    isActive: true,
  },
  {
    id: 'airtel',
    name: 'Airtel Data',
    type: 'data',
    serviceID: 'airtel-data',
    isActive: true,
  },
  {
    id: 'glo',
    name: 'Glo Data',
    type: 'data',
    serviceID: 'glo-data',
    isActive: true,
  },
  {
    id: '9mobile',
    name: '9mobile Data',
    type: 'data',
    serviceID: 'etisalat-data',
    isActive: true,
  },
  {
    id: 'dstv',
    name: 'DStv',
    type: 'cable',
    serviceID: 'dstv',
    isActive: true,
  },
  {
    id: 'gotv',
    name: 'GOtv',
    type: 'cable',
    serviceID: 'gotv',
    isActive: true,
  },
  {
    id: 'startimes',
    name: 'StarTimes',
    type: 'cable',
    serviceID: 'startimes',
    isActive: true,
  },
  {
    id: 'ikedc',
    name: 'Ikeja Electric',
    type: 'electricity',
    serviceID: 'ikeja-electric',
    isActive: true,
  },
  {
    id: 'ekedc',
    name: 'Eko Electric',
    type: 'electricity',
    serviceID: 'eko-electric',
    isActive: true,
  },
  {
    id: 'aedc',
    name: 'Abuja Electric',
    type: 'electricity',
    serviceID: 'abuja-electric',
    isActive: true,
  },
  {
    id: 'ibedc',
    name: 'Ibadan Electric',
    type: 'electricity',
    serviceID: 'ibadan-electric',
    isActive: true,
  },
  {
    id: 'phed',
    name: 'Port Harcourt Electric',
    type: 'electricity',
    serviceID: 'portharcourt-electric',
    isActive: true,
  },
  {
    id: 'jed',
    name: 'Jos Electric',
    type: 'electricity',
    serviceID: 'jos-electric',
    isActive: true,
  },
  {
    id: 'kedco',
    name: 'Kano Electric',
    type: 'electricity',
    serviceID: 'kano-electric',
    isActive: true,
  },
  {
    id: 'kaedco',
    name: 'Kaduna Electric',
    type: 'electricity',
    serviceID: 'kaduna-electric',
    isActive: true,
  },
  {
    id: 'eedc',
    name: 'Enugu Electric',
    type: 'electricity',
    serviceID: 'enugu-electric',
    isActive: true,
  },
  {
    id: 'bedc',
    name: 'Benin Electric',
    type: 'electricity',
    serviceID: 'benin-electric',
    isActive: true,
  },
  {
    id: 'aba',
    name: 'ABA Power',
    type: 'electricity',
    serviceID: 'aba-electric',
    isActive: true,
  },
  {
    id: 'yedc',
    name: 'Yola Electric',
    type: 'electricity',
    serviceID: 'yola-electric',
    isActive: true,
  },
];

@Injectable()
export class VtuApiProvider {
  private static readonly CIRCUIT = 'vtpass';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly publicKey: string;
  private readonly secretKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {
    this.baseUrl = this.configService.get<string>('VTPASS_BASE_URL') || '';
    this.apiKey = this.configService.get<string>('VTPASS_API_KEY') || '';
    this.publicKey = this.configService.get<string>('VTPASS_PUBLIC_KEY') || '';
    this.secretKey = this.configService.get<string>('VTPASS_SECRET_KEY') || '';
    this.logger.setContext(VtuApiProvider.name);

    if (
      this.configService.get<string>('NODE_ENV') === 'production' &&
      this.isEnabled() &&
      (!this.baseUrl || !this.apiKey || !this.publicKey || !this.secretKey)
    ) {
      throw new Error('VTpass provider credentials are not configured');
    }
  }

  private get vtpassGetHeaders() {
    return {
      'Content-Type': 'application/json',
      'api-key': this.apiKey,
      'public-key': this.publicKey,
    };
  }

  private get vtpassPostHeaders() {
    return {
      'Content-Type': 'application/json',
      'api-key': this.apiKey,
      'secret-key': this.secretKey,
    };
  }

  getProviders(type?: string): Promise<VtuProvider[]> {
    return Promise.resolve(this.getVtpassProviders(type));
  }

  getProviderName() {
    return 'VTPASS';
  }

  async getVtpassHealth(): Promise<VtuProviderHealth> {
    const warnings: string[] = [];
    const requiredCredentials = {
      baseUrl: Boolean(this.baseUrl),
      apiKey: Boolean(this.apiKey),
      publicKey: Boolean(this.publicKey),
      secretKey: Boolean(this.secretKey),
    };
    const configured = Object.values(requiredCredentials).every(Boolean);
    const enabled = this.isEnabled();

    for (const [name, isConfigured] of Object.entries(requiredCredentials)) {
      if (!isConfigured) {
        warnings.push(`Missing VTpass ${name} configuration.`);
      }
    }

    if (!enabled || !configured) {
      return {
        id: 'vtpass',
        name: 'VTpass',
        configured,
        enabled,
        supportsBalance: true,
        balance: { status: 'unknown', currency: 'NGN' },
        warnings,
      };
    }

    try {
      const response = await this.executeProviderRequest(() =>
        firstValueFrom(
          this.httpService.get<VtpassBalanceResponse>(
            `${this.baseUrl}/balance`,
            { headers: this.vtpassGetHeaders },
          ),
        ),
      );
      const balance = this.parseNumericAmount(response.data.contents?.balance);

      if (balance === null) {
        warnings.push(
          'VTpass balance response did not include a valid amount.',
        );
        return {
          id: 'vtpass',
          name: 'VTpass',
          configured,
          enabled,
          supportsBalance: true,
          balance: { status: 'error', currency: 'NGN', checkedAt: new Date() },
          warnings,
        };
      }

      const threshold = this.getConfiguredThreshold(
        'VTPASS_LOW_BALANCE_THRESHOLD',
        5000,
      );
      if (balance < threshold) {
        warnings.push(
          `VTpass balance is below configured threshold of NGN ${threshold}.`,
        );
      }

      return {
        id: 'vtpass',
        name: 'VTpass',
        configured,
        enabled,
        supportsBalance: true,
        balance: {
          status: 'available',
          amount: balance.toString(),
          currency: 'NGN',
          checkedAt: new Date(),
        },
        warnings,
      };
    } catch (error) {
      this.logger.warn(
        this.safeProviderError(error),
        'Unable to retrieve VTpass wallet balance',
      );
      warnings.push('Unable to retrieve VTpass wallet balance.');

      return {
        id: 'vtpass',
        name: 'VTpass',
        configured,
        enabled,
        supportsBalance: true,
        balance: { status: 'error', currency: 'NGN', checkedAt: new Date() },
        warnings,
      };
    }
  }

  async getPackages(provider: string): Promise<VtuPackage[]> {
    return this.getVtpassPackages(provider);
  }

  async purchase(params: VtuProviderPurchase): Promise<VtuProviderResult> {
    return this.purchaseViaVtpass(params);
  }

  async validateSmartCard(
    provider: string,
    smartCardNumber: string,
  ): Promise<{ name: string; status: string; renewalAmount?: string }> {
    if (!this.baseUrl) {
      this.assertSimulationEnabled();
      return { name: 'Test User', status: 'active', renewalAmount: '6500.00' };
    }

    const service = this.findVtpassService(provider, ['cable']);
    if (!service) {
      throw new BadRequestException('Unsupported VTpass cable service');
    }

    const content = await this.vtpassMerchantVerify({
      serviceID: service.serviceID,
      billersCode: smartCardNumber,
    });

    return {
      name: content.Customer_Name || 'Unknown customer',
      status: (content.Status || 'active').toLowerCase(),
      renewalAmount: this.optionalMoney(content.Renewal_Amount),
    };
  }

  async validateMeter(
    provider: string,
    meterNumber: string,
    meterType: VtuMeterType = 'prepaid',
  ): Promise<{ name: string; address: string }> {
    if (!this.baseUrl) {
      this.assertSimulationEnabled();
      return { name: 'Test Customer', address: 'Test Address' };
    }

    const service = this.findVtpassService(provider, ['electricity']);
    if (!service) {
      throw new BadRequestException('Unsupported VTpass electricity service');
    }

    const content = await this.vtpassMerchantVerify({
      serviceID: service.serviceID,
      billersCode: meterNumber,
      type: meterType,
    });

    return {
      name: content.Customer_Name || 'Unknown customer',
      address: content.Address || '',
    };
  }

  private async vtpassMerchantVerify(payload: {
    serviceID: string;
    billersCode: string;
    type?: string;
  }) {
    let response: VtpassMerchantVerifyResponse;
    try {
      const httpResponse = await this.executeProviderRequest(() =>
        firstValueFrom(
          this.httpService.post<VtpassMerchantVerifyResponse>(
            `${this.baseUrl}/merchant-verify`,
            payload,
            { headers: this.vtpassPostHeaders },
          ),
        ),
      );
      response = httpResponse.data;
    } catch (error) {
      this.logger.warn(
        this.safeProviderError(error),
        'VTpass merchant verification request failed',
      );
      throw new ServiceUnavailableException(
        'Customer verification is temporarily unavailable. Try again shortly.',
      );
    }

    const content = response.content;
    if (!content || content.error || `${response.code}` !== '000') {
      throw new BadRequestException(
        'We could not verify this customer number. Check it and try again.',
      );
    }

    return content;
  }

  private getFallbackPackages(provider: string): VtuPackage[] {
    const packages: Record<string, VtuPackage[]> = {
      mtn: [
        {
          id: 'mtn-500mb',
          name: '500MB',
          price: '150.00',
          validity: '30 days',
          serviceType: 'data',
        },
        {
          id: 'mtn-1gb',
          name: '1GB',
          price: '300.00',
          validity: '30 days',
          serviceType: 'data',
        },
        {
          id: 'mtn-2gb',
          name: '2GB',
          price: '500.00',
          validity: '30 days',
          serviceType: 'data',
        },
        {
          id: 'mtn-5gb',
          name: '5GB',
          price: '1200.00',
          validity: '30 days',
          serviceType: 'data',
        },
      ],
      airtel: [
        {
          id: 'airtel-500mb',
          name: '500MB',
          price: '150.00',
          validity: '30 days',
          serviceType: 'data',
        },
        {
          id: 'airtel-1gb',
          name: '1GB',
          price: '300.00',
          validity: '30 days',
          serviceType: 'data',
        },
        {
          id: 'airtel-2gb',
          name: '2GB',
          price: '500.00',
          validity: '30 days',
          serviceType: 'data',
        },
      ],
      glo: [
        {
          id: 'glo-1gb',
          name: '1GB',
          price: '250.00',
          validity: '30 days',
          serviceType: 'data',
        },
        {
          id: 'glo-2gb',
          name: '2GB',
          price: '500.00',
          validity: '30 days',
          serviceType: 'data',
        },
      ],
      '9mobile': [
        {
          id: 'eti-500',
          name: '500MB',
          price: '500.00',
          validity: '30 days',
          serviceType: 'data',
        },
        {
          id: 'eti-1000',
          name: '1.5GB',
          price: '1000.00',
          validity: '30 days',
          serviceType: 'data',
        },
      ],
      dstv: [
        {
          id: 'dstv-jolli',
          name: 'Jolli',
          price: '6500.00',
          validity: '30 days',
          serviceType: 'cable',
        },
        {
          id: 'dstv-premium',
          name: 'Premium',
          price: '29500.00',
          validity: '30 days',
          serviceType: 'cable',
        },
      ],
      gotv: [
        {
          id: 'gotv-jinja',
          name: 'Jinja',
          price: '3100.00',
          validity: '30 days',
          serviceType: 'cable',
        },
        {
          id: 'gotv-max',
          name: 'Max',
          price: '9300.00',
          validity: '30 days',
          serviceType: 'cable',
        },
      ],
    };

    return packages[provider] || [];
  }

  private getVtpassProviders(type?: string): VtuProvider[] {
    return VTPASS_SERVICES.filter(
      (service) => !type || service.type === type,
    ).map((service) => ({
      id: service.id,
      name: service.name,
      type: service.type,
      isActive: service.isActive,
    }));
  }

  private async getVtpassPackages(provider: string): Promise<VtuPackage[]> {
    if (!this.baseUrl) {
      this.assertSimulationEnabled();
      return this.getFallbackPackages(provider);
    }

    const service = this.findVtpassService(provider, ['data', 'cable']);
    if (!service) {
      return [];
    }

    try {
      const response = await this.executeProviderRequest(() =>
        firstValueFrom(
          this.httpService.get<VtpassResponse>(
            `${this.baseUrl}/service-variations`,
            {
              headers: this.vtpassGetHeaders,
              params: { serviceID: service.serviceID },
            },
          ),
        ),
      );
      const variations =
        response.data.content?.variations || response.data.content?.varations;

      return (variations || [])
        .filter((variation) => variation.variation_code)
        .map((variation) => ({
          id: variation.variation_code as string,
          name: variation.name || variation.variation_code || 'VTU package',
          price: this.requiredMoney(variation.variation_amount),
          validity: this.extractValidity(variation.name),
          serviceType: service.type as 'data' | 'cable',
        }))
        .filter((variation) => new Decimal(variation.price).greaterThan(0));
    } catch (error) {
      this.logger.warn(
        this.safeProviderError(error),
        'VTpass variations unavailable',
      );
      throw new ServiceUnavailableException(
        'VTpass packages are temporarily unavailable',
      );
    }
  }

  private async purchaseViaVtpass(
    params: VtuProviderPurchase,
  ): Promise<VtuProviderResult> {
    if (!this.baseUrl) {
      this.assertSimulationEnabled();
      return this.simulatePurchase(params);
    }

    const service = this.findVtpassService(params.provider, [params.type]);
    if (!service) {
      throw new BadRequestException('Unsupported VTpass service');
    }

    const requestId =
      params.providerRequestId ||
      this.createProviderRequestId(params.reference);
    const payload = this.buildVtpassPurchasePayload(params, service, requestId);

    try {
      const response = await this.executeProviderRequest(() =>
        firstValueFrom(
          this.httpService.post<VtpassResponse>(
            `${this.baseUrl}/pay`,
            payload,
            { headers: this.vtpassPostHeaders },
          ),
        ),
      );
      return this.mapVtpassPurchaseResponse(response.data, requestId);
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        'VTpass purchase request failed with unknown provider result',
      );
      throw new Error('VTU provider result unknown');
    }
  }

  private buildVtpassPurchasePayload(
    params: VtuProviderPurchase,
    service: VtpassServiceDefinition,
    requestId: string,
  ) {
    if (params.type === 'airtime') {
      return {
        request_id: requestId,
        serviceID: service.serviceID,
        amount: this.requiredMoney(params.amount),
        phone: this.toVtpassPhone(params.recipientNumber),
      };
    }

    if (params.type === 'data') {
      return {
        request_id: requestId,
        serviceID: service.serviceID,
        billersCode: this.toVtpassPhone(params.recipientNumber),
        variation_code: params.packageId,
        amount: this.requiredMoney(params.amount),
        phone: this.toVtpassPhone(params.contactPhone),
      };
    }

    if (params.type === 'cable') {
      const payload: Record<string, unknown> = {
        request_id: requestId,
        serviceID: service.serviceID,
        billersCode: params.smartCardNumber,
        amount: this.requiredMoney(params.amount),
        phone: this.toVtpassPhone(params.contactPhone),
        subscription_type: params.subscriptionType,
      };
      if (params.subscriptionType === 'change') {
        payload.variation_code = params.packageId;
      }
      return payload;
    }

    return {
      request_id: requestId,
      serviceID: service.serviceID,
      billersCode: params.meterNumber,
      variation_code: params.meterType,
      amount: this.requiredMoney(params.amount),
      phone: this.toVtpassPhone(params.contactPhone),
    };
  }

  private mapVtpassPurchaseResponse(data: VtpassResponse, requestId: string) {
    const transaction = data.content?.transactions;
    const providerTransactionId =
      transaction?.transactionId || data.requestId || requestId;
    const safeResponse = {
      code: data.code,
      responseDescription: data.response_description,
      requestId: data.requestId || requestId,
      providerTransactionId,
      providerStatus: transaction?.status,
      providerCost: this.optionalMoney(transaction?.total_amount),
      providerCommission: this.optionalMoney(transaction?.commission),
    };
    return {
      reference: providerTransactionId,
      providerTransactionId,
      status: this.normalizeVtpassStatus(data),
      message:
        data.response_description ||
        data.content?.transactions?.status ||
        'VTpass transaction submitted',
      providerRequestId: requestId,
      providerCost: this.optionalMoney(transaction?.total_amount),
      providerCommission: this.optionalMoney(transaction?.commission),
      purchasedCode:
        typeof data.purchased_code === 'string' && data.purchased_code.trim()
          ? data.purchased_code.trim()
          : undefined,
      safeResponse,
      rawResponse: safeResponse,
    };
  }

  async requery(providerRequestId: string): Promise<VtuProviderResult> {
    if (!this.baseUrl) {
      this.assertSimulationEnabled();
      return this.simulateResult(providerRequestId, 'VTU requery simulated');
    }

    try {
      const response = await this.executeProviderRequest(() =>
        firstValueFrom(
          this.httpService.post<VtpassResponse>(
            `${this.baseUrl}/requery`,
            { request_id: providerRequestId },
            { headers: this.vtpassPostHeaders },
          ),
        ),
      );
      return this.mapVtpassPurchaseResponse(response.data, providerRequestId);
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        'VTpass requery failed with unknown provider result',
      );
      throw new Error('VTU provider result unknown');
    }
  }

  private normalizeVtpassStatus(data: VtpassResponse): NormalizedVtuStatus {
    const status = data.content?.transactions?.status?.toLowerCase();
    const code = data.code;
    const description = data.response_description?.toLowerCase() || '';

    if (
      status &&
      ['delivered', 'successful', 'success', 'completed'].includes(status)
    ) {
      return 'success';
    }

    if (
      status &&
      ['pending', 'initiated', 'processing', 'queued'].includes(status)
    ) {
      return 'pending';
    }

    if (
      status &&
      ['failed', 'reversed', 'refunded', 'cancelled', 'rejected'].includes(
        status,
      )
    ) {
      return status === 'reversed' || status === 'refunded'
        ? 'reversed'
        : 'failed';
    }

    if (code === '099') {
      return 'pending';
    }

    if (['016', '091', '010', '011', '012', '030'].includes(code || '')) {
      return 'failed';
    }

    if (code === '000' && description.includes('successful')) {
      return 'success';
    }

    return 'pending';
  }

  private findVtpassService(provider: string, types: VtuServiceType[]) {
    return VTPASS_SERVICES.find(
      (service) => service.id === provider && types.includes(service.type),
    );
  }

  createProviderRequestId(reference: string, date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .reduce<Record<string, string>>((acc, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});
    const prefix = `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
    const suffix = reference.replace(/[^A-Za-z0-9]/g, '').slice(-24);

    return `${prefix}${suffix}`;
  }

  private extractValidity(name?: string) {
    if (!name) {
      return 'Provider defined';
    }

    const match = name.match(
      /(\d+\s*(?:hrs|hr|hours|hour|days|day|months|month))/i,
    );
    return match?.[1] || 'Provider defined';
  }

  private simulatePurchase(params: VtuProviderPurchase): VtuProviderResult {
    return this.simulateResult(
      params.providerRequestId || params.reference,
      `${params.type} purchase simulated successfully`,
      'success',
    );
  }

  private simulateResult(
    reference: string,
    message: string,
    status: NormalizedVtuStatus = 'pending',
  ): VtuProviderResult {
    const safeResponse = { simulated: true, providerStatus: status };
    return {
      reference,
      providerRequestId: reference,
      providerTransactionId: reference,
      status,
      message,
      safeResponse,
      rawResponse: safeResponse,
    };
  }

  private assertSimulationEnabled() {
    const environment = this.configService.get<string>('NODE_ENV');
    const configured = this.configService.get<unknown>(
      'VTU_SIMULATION_ENABLED',
    );
    const enabled = configured === true || configured === 'true';
    if (!enabled || !['development', 'test'].includes(environment || '')) {
      throw new ServiceUnavailableException('VTpass is not configured');
    }
  }

  private toVtpassPhone(value?: string) {
    if (!value) return undefined;
    return value.replace(/^\+234/, '0');
  }

  private requiredMoney(value: unknown) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new BadRequestException('Invalid VTpass monetary value');
    }

    const normalizedValue = typeof value === 'string' ? value.trim() : value;
    if (normalizedValue === '') {
      throw new BadRequestException('Invalid VTpass monetary value');
    }

    let amount: Decimal;
    try {
      amount = new Decimal(normalizedValue);
    } catch {
      throw new BadRequestException('Invalid VTpass monetary value');
    }
    if (!amount.isFinite() || amount.isNegative()) {
      throw new BadRequestException('Invalid VTpass monetary value');
    }
    return amount.toFixed(2);
  }

  private optionalMoney(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    try {
      return this.requiredMoney(value);
    } catch {
      return undefined;
    }
  }

  private async executeProviderRequest<T>(request: () => Promise<T>) {
    if (!(await this.circuitBreaker.canExecute(VtuApiProvider.CIRCUIT))) {
      throw new ServiceUnavailableException(
        'VTpass is temporarily unavailable. Try again shortly.',
      );
    }

    try {
      const result = await request();
      await this.circuitBreaker.recordSuccess(VtuApiProvider.CIRCUIT);
      return result;
    } catch (error) {
      await this.circuitBreaker.recordFailure(VtuApiProvider.CIRCUIT);
      throw error;
    }
  }

  private parseNumericAmount(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(parsed) ? parsed : null;
  }

  private getConfiguredThreshold(key: string, fallback: number) {
    const configured = Number(this.configService.get<string>(key));
    return Number.isFinite(configured) && configured >= 0
      ? configured
      : fallback;
  }

  private isEnabled() {
    const value = this.configService.get<unknown>('VTU_ENABLED');
    return value !== false && value !== 'false';
  }

  private safeProviderError(error: unknown) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      response?: { status?: unknown };
    };

    return {
      code: typeof candidate?.code === 'string' ? candidate.code : undefined,
      status:
        typeof candidate?.response?.status === 'number'
          ? candidate.response.status
          : undefined,
      message:
        typeof candidate?.message === 'string'
          ? candidate.message
          : 'Unknown provider error',
    };
  }
}
