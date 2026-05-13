import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';

interface FxRateResponse {
  rates: Record<string, number>;
}

@Injectable()
export class RateService implements OnModuleInit {
  private readonly logger = new Logger(RateService.name);
  private readonly cache: Map<
    string,
    { rate: number; markup: number; validUntil: Date }
  > = new Map();
  private readonly cacheTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.cacheTtlMs = 60 * 60 * 1000;
  }

  async onModuleInit() {
    await this.fetchRates();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRateFetch() {
    this.logger.log('Running scheduled rate fetch...');
    await this.fetchRates();
  }

  async getRate(
    from: string,
    to: string,
  ): Promise<{ rate: number; markup: number }> {
    const key = `${from}_${to}`;
    const cached = this.cache.get(key);

    if (cached && cached.validUntil > new Date()) {
      return { rate: cached.rate, markup: cached.markup };
    }

    await this.fetchRates();

    const refreshed = this.cache.get(key);
    if (refreshed) {
      return { rate: refreshed.rate, markup: refreshed.markup };
    }

    throw new Error(`Rate not available for ${from} to ${to}`);
  }

  async setManualRate(
    from: string,
    to: string,
    rate: number,
    markup: number,
  ): Promise<void> {
    const key = `${from}_${to}`;

    await this.prisma.rate.upsert({
      where: {
        from_to: { from, to },
      },
      update: { rate: String(rate), markup: String(markup), source: 'admin' },
      create: {
        from,
        to,
        rate: String(rate),
        markup: String(markup),
        source: 'admin',
      },
    });

    this.cache.set(key, {
      rate,
      markup,
      validUntil: new Date(Date.now() + this.cacheTtlMs),
    });

    this.logger.log(
      `Manual rate set: ${from}/${to} = ${rate} (markup: ${markup}%)`,
    );
  }

  private async fetchRates(): Promise<void> {
    const apiUrl = this.configService.get<string>('FX_RATE_API_URL');
    const apiKey = this.configService.get<string>('FX_RATE_API_KEY');

    if (!apiUrl || !apiKey) {
      this.logger.warn('FX Rate API not configured. Using fallback rates.');
      await this.loadFallbackRates();
      return;
    }

    try {
      const response: AxiosResponse<FxRateResponse> = await firstValueFrom(
        this.httpService.get<FxRateResponse>(apiUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        }),
      );

      const rates = response.data?.rates;
      if (rates) {
        await this.saveRatesToDatabase(rates);
        this.logger.log('FX rates fetched and cached successfully');
      }
    } catch (error) {
      this.logger.error(
        'Failed to fetch FX rates from API, using fallback',
        error,
      );
      await this.loadFallbackRates();
    }
  }

  private async loadFallbackRates(): Promise<void> {
    const fallbackRates = {
      NGN_GHS: 0.315,
      GHS_NGN: 3.1746,
    };

    const defaultMarkup = 2.5;

    for (const [pair, rate] of Object.entries(fallbackRates)) {
      const [from, to] = pair.split('_');
      await this.prisma.rate.upsert({
        where: { from_to: { from, to } },
        update: { rate: String(rate), source: 'fallback' },
        create: {
          from,
          to,
          rate: String(rate),
          markup: String(defaultMarkup),
          source: 'fallback',
        },
      });

      this.cache.set(pair, {
        rate,
        markup: defaultMarkup,
        validUntil: new Date(Date.now() + this.cacheTtlMs),
      });
    }

    this.logger.log('Fallback rates loaded');
  }

  private async saveRatesToDatabase(
    rates: Record<string, number>,
  ): Promise<void> {
    const markupPercent = 2.5;

    const ghsNgn = rates['GHS_NGN'] || rates['NGN'] || 3.1746;
    const ngnGhs = rates['NGN_GHS'] || 1 / ghsNgn;

    const ratePairs = [
      { from: 'GHS', to: 'NGN', rate: ghsNgn },
      { from: 'NGN', to: 'GHS', rate: ngnGhs },
    ];

    for (const { from, to, rate } of ratePairs) {
      await this.prisma.rate.upsert({
        where: { from_to: { from, to } },
        update: { rate: String(rate), source: 'api', updatedAt: new Date() },
        create: {
          from,
          to,
          rate: String(rate),
          markup: String(markupPercent),
          source: 'api',
        },
      });

      const key = `${from}_${to}`;
      this.cache.set(key, {
        rate,
        markup: markupPercent,
        validUntil: new Date(Date.now() + this.cacheTtlMs),
      });
    }
  }
}
