import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

export interface VtuProvider {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface VtuPackage {
  id: string;
  name: string;
  price: number;
  validity: string;
}

@Injectable()
export class VtuApiProvider {
  private readonly logger = new Logger(VtuApiProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('VTU_API_URL') || '';
    this.apiKey = this.configService.get<string>('VTU_API_KEY') || '';
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async getProviders(type?: string): Promise<VtuProvider[]> {
    if (!this.baseUrl) {
      return this.getFallbackProviders(type);
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ providers: VtuProvider[] }>(
          `${this.baseUrl}/providers${type ? `?type=${type}` : ''}`,
          { headers: this.headers },
        ),
      );
      return response.data.providers;
    } catch (error) {
      this.logger.warn('VTU API unavailable, using fallback providers');
      return this.getFallbackProviders(type);
    }
  }

  async getPackages(provider: string): Promise<VtuPackage[]> {
    if (!this.baseUrl) {
      return this.getFallbackPackages(provider);
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ packages: VtuPackage[] }>(
          `${this.baseUrl}/packages?provider=${provider}`,
          { headers: this.headers },
        ),
      );
      return response.data.packages;
    } catch (error) {
      this.logger.warn('VTU API unavailable, using fallback packages');
      return this.getFallbackPackages(provider);
    }
  }

  async purchase(params: {
    type: string;
    provider: string;
    recipientNumber: string;
    amount: number;
    packageId?: string;
    smartCardNumber?: string;
    meterNumber?: string;
  }): Promise<{ reference: string; status: string; message: string }> {
    if (!this.baseUrl) {
      return this.simulatePurchase(params);
    }

    const payload = {
      type: params.type,
      provider: params.provider,
      phone_number: params.recipientNumber,
      amount: params.amount,
      package_id: params.packageId,
      smart_card_number: params.smartCardNumber,
      meter_number: params.meterNumber,
      reference: uuidv4(),
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<{
          reference: string;
          status: string;
          message: string;
        }>(`${this.baseUrl}/purchase`, payload, { headers: this.headers }),
      );

      return response.data;
    } catch (error) {
      this.logger.error('VTU purchase failed', error);
      throw new Error('VTU purchase failed');
    }
  }

  async validateSmartCard(
    provider: string,
    smartCardNumber: string,
  ): Promise<{ name: string; status: string }> {
    if (!this.baseUrl) {
      return { name: 'Test User', status: 'active' };
    }

    const response = await firstValueFrom(
      this.httpService.get<{ name: string; status: string }>(
        `${this.baseUrl}/validate?provider=${provider}&number=${smartCardNumber}`,
        { headers: this.headers },
      ),
    );

    return response.data;
  }

  async validateMeter(
    provider: string,
    meterNumber: string,
  ): Promise<{ name: string; address: string }> {
    if (!this.baseUrl) {
      return { name: 'Test Customer', address: 'Test Address' };
    }

    const response = await firstValueFrom(
      this.httpService.get<{ name: string; address: string }>(
        `${this.baseUrl}/validate-meter?provider=${provider}&number=${meterNumber}`,
        { headers: this.headers },
      ),
    );

    return response.data;
  }

  private getFallbackProviders(type?: string): VtuProvider[] {
    const allProviders: VtuProvider[] = [
      { id: 'mtn', name: 'MTN', type: 'airtime', isActive: true },
      { id: 'airtel', name: 'Airtel', type: 'airtime', isActive: true },
      { id: 'glo', name: 'Glo', type: 'airtime', isActive: true },
      { id: 'dstv', name: 'DStv', type: 'cable', isActive: true },
      { id: 'gotv', name: 'GOtv', type: 'cable', isActive: true },
      { id: 'startimes', name: 'StarTimes', type: 'cable', isActive: true },
      {
        id: 'ikedc',
        name: 'Ikeja Electric',
        type: 'electricity',
        isActive: true,
      },
      {
        id: 'ekedc',
        name: 'Eko Electric',
        type: 'electricity',
        isActive: true,
      },
      {
        id: 'aedc',
        name: 'Abuja Electric',
        type: 'electricity',
        isActive: true,
      },
    ];

    if (type) {
      return allProviders.filter((p) => p.type === type);
    }

    return allProviders;
  }

  private getFallbackPackages(provider: string): VtuPackage[] {
    const packages: Record<string, VtuPackage[]> = {
      mtn: [
        { id: 'mtn-500mb', name: '500MB', price: 150, validity: '30 days' },
        { id: 'mtn-1gb', name: '1GB', price: 300, validity: '30 days' },
        { id: 'mtn-2gb', name: '2GB', price: 500, validity: '30 days' },
        { id: 'mtn-5gb', name: '5GB', price: 1200, validity: '30 days' },
      ],
      airtel: [
        { id: 'airtel-500mb', name: '500MB', price: 150, validity: '30 days' },
        { id: 'airtel-1gb', name: '1GB', price: 300, validity: '30 days' },
        { id: 'airtel-2gb', name: '2GB', price: 500, validity: '30 days' },
      ],
      glo: [
        { id: 'glo-1gb', name: '1GB', price: 250, validity: '30 days' },
        { id: 'glo-2gb', name: '2GB', price: 500, validity: '30 days' },
      ],
      dstv: [
        { id: 'dstv-jolli', name: 'Jolli', price: 6500, validity: '30 days' },
        {
          id: 'dstv-premium',
          name: 'Premium',
          price: 29500,
          validity: '30 days',
        },
      ],
      gotv: [
        { id: 'gotv-jinja', name: 'Jinja', price: 3100, validity: '30 days' },
        { id: 'gotv-max', name: 'Max', price: 9300, validity: '30 days' },
      ],
    };

    return packages[provider] || [];
  }

  private simulatePurchase(params: {
    type: string;
    provider: string;
    recipientNumber: string;
    amount: number;
  }): { reference: string; status: string; message: string } {
    return {
      reference: `VTU-${Date.now()}-${uuidv4().slice(0, 8)}`,
      status: 'success',
      message: `${params.type} purchase simulated successfully`,
    };
  }
}
