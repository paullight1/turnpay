import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export class AdminExchangeRateNotSetException extends ServiceUnavailableException {
  constructor() {
    super('Admin has not set an active exchange rate for this direction.');
  }
}

interface FxRateResponse {
  result?: string;
  base_code?: string;
  base?: string;
  rates?: Record<string, unknown>;
  conversion_rates?: Record<string, unknown>;
  // Generic fallback shape
  data?: {
    base_code?: string;
    base?: string;
    rates?: Record<string, unknown>;
    conversion_rates?: Record<string, unknown>;
  };
}

interface CachedRate {
  rate: number;
  markup: number;
  fetchedAt: number;
  /** Absolute expiry copied from the persisted rate when available. */
  validUntil?: number | null;
  /** Fallback rates are display-only and must never be treated as executable. */
  source?: string;
}

interface RateResult {
  rate: number;
  markup: number;
  isStale: boolean;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const RATE_CACHE_REDIS_PREFIX = 'fx:rate:';
const RATE_FRESHNESS_TTL_MS = 60_000; // 60 seconds freshness
const RATE_STALE_RETENTION_SECONDS = 300; // 5 min Redis retention for stale reads
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RECOVERY_MS = 30_000; // 30 seconds before half-open attempt
const CIRCUIT_REDIS_KEY = 'fx:circuit:state';
const CIRCUIT_FAILURES_KEY = 'fx:circuit:failures';
const CIRCUIT_OPENED_AT_KEY = 'fx:circuit:openedAt';
const DEFAULT_MARKUP_PERCENT = 2.5;

@Injectable()
export class RateService implements OnModuleInit {
  private readonly memoryCache: Map<string, CachedRate> = new Map();

  private circuitState: CircuitState = 'CLOSED';
  private circuitFailures: number = 0;
  private circuitOpenedAt: number = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {}

  async onModuleInit() {
    if (this.usesAdminRates()) return;
    // Restore circuit breaker state from Redis if available
    await this.restoreCircuitState();
    // Warm the cache on startup
    await this.fetchRates();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledRateFetch() {
    if (this.usesAdminRates()) return;
    this.logger.info({}, 'Running scheduled rate fetch (every 60s)');
    await this.fetchRates();
  }

  /**
   * Get the current exchange rate for a currency pair.
   * Returns isStale=true whenever a rate is outside its execution freshness
   * window, while still retaining a bounded stale value for display.
   */
  async getRate(from: string, to: string): Promise<RateResult> {
    if (this.usesAdminRates()) return this.getAdminRate(from, to);
    const key = `${from}_${to}`;

    // Check in-memory cache first (fast path)
    const memoryCached = this.memoryCache.get(key);
    if (memoryCached && this.isFresh(memoryCached)) {
      return {
        rate: memoryCached.rate,
        markup: memoryCached.markup,
        isStale: false,
      };
    }

    // Try Redis cache (second layer, survives restarts)
    const redisCached = await this.loadFromRedis(key);
    if (redisCached && this.isFresh(redisCached)) {
      this.memoryCache.set(key, redisCached);
      return {
        rate: redisCached.rate,
        markup: redisCached.markup,
        isStale: false,
      };
    }

    // Try DB stored rate
    const stored = await this.loadStoredRate(from, to);
    if (stored && this.isFresh(stored)) {
      return {
        rate: stored.rate,
        markup: stored.markup,
        isStale: false,
      };
    }

    // Circuit is open — serve stale rate if available
    if (this.circuitState === 'OPEN') {
      const staleRate = await this.getStaleRate(key);
      if (staleRate) {
        this.logger.warn(
          { from, to, rate: staleRate.rate },
          'Circuit OPEN — serving stale rate',
        );
        return {
          rate: staleRate.rate,
          markup: staleRate.markup,
          isStale: true,
        };
      }
    }

    // No cached rate — attempt fetch (respects circuit breaker)
    await this.fetchRates();

    const refreshed = this.memoryCache.get(key);
    if (refreshed && this.isFresh(refreshed)) {
      return {
        rate: refreshed.rate,
        markup: refreshed.markup,
        isStale: false,
      };
    }

    // A failed fetch can leave a stale DB/cache value in memory even while
    // the circuit is still closed (before the failure threshold is reached).
    // Keep that value available for read-only display, but mark it stale so
    // execution callers can reject it.
    const staleRate = await this.getStaleRate(key);
    if (staleRate) {
      this.logger.warn(
        { from, to, rate: staleRate.rate },
        'Serving bounded stale rate after refresh failure',
      );
      return {
        rate: staleRate.rate,
        markup: staleRate.markup,
        isStale: true,
      };
    }

    // Last resort: hardcoded fallback rates
    const fallback = this.getFallbackRate(from, to);
    if (fallback) {
      this.logger.error(
        { from, to, rate: fallback.rate },
        'No rate available — using hardcoded fallback',
      );
      return { ...fallback, isStale: true };
    }

    throw new Error(`Rate not available for ${from} to ${to}`);
  }

  private usesAdminRates(): boolean {
    return (
      (this.configService.get<string>('FX_RATE_SOURCE') ?? 'admin') !== 'api'
    );
  }

  private async getAdminRate(from: string, to: string): Promise<RateResult> {
    // The database is authoritative: another admin/process may have changed
    // the price. Do not substitute an API value or an old Redis/memory entry.
    const stored = await this.prisma.rate.findUnique({
      where: { from_to: { from, to } },
    });
    const rate = stored?.rate.toNumber();
    const markup = stored?.markup.toNumber();
    const expiry = stored?.validUntil?.getTime();
    if (
      stored?.source !== 'admin' ||
      !this.isFinitePositiveRate(rate) ||
      !this.isGhanaRateDirectionValid(from, to, rate) ||
      markup === undefined ||
      !Number.isFinite(markup) ||
      markup < 0 ||
      markup >= 100 ||
      (expiry !== undefined &&
        (!Number.isFinite(expiry) || expiry <= Date.now()))
    )
      throw new AdminExchangeRateNotSetException();
    // Admin prices stay active until replaced or explicitly expired. The
    // short market-feed freshness window applies only to API mode.
    return { rate: rate, markup, isStale: false };
  }

  /**
   * Admin manually sets a rate override.
   * Writes audit log with actor, reason, old rate, and new rate.
   */
  async setManualRate(
    from: string,
    to: string,
    rate: number,
    markup: number,
    adminId?: string,
    reason?: string,
    database: PrismaService | Prisma.TransactionClient = this.prisma,
    options: { refreshCache?: boolean } = {},
  ): Promise<{ rate: number; markup: number }> {
    const persistedRate = this.normalizePersistedRate(rate);
    if (!this.isGhanaRateDirectionValid(from, to, persistedRate)) {
      throw new BadRequestException(
        'Rate direction is invalid. Enter GHS received per 1 NGN (below 1), or NGN received per 1 GHS (above 1).',
      );
    }
    const persistedMarkup = this.normalizePersistedMarkup(markup);

    const persistRateAndAudit = async (
      db: PrismaService | Prisma.TransactionClient,
    ) => {
      // Get the old rate and write the new rate/audit record in one DB
      // transaction for direct admin overrides. The dual-approval path passes
      // its existing transaction client and writes its review audit there.
      const oldRate = await db.rate.findUnique({
        where: { from_to: { from, to } },
      });

      const oldRateValue = oldRate
        ? {
            rate: oldRate.rate.toNumber(),
            markup: oldRate.markup.toNumber(),
            source: oldRate.source,
          }
        : null;

      await db.rate.upsert({
        where: {
          from_to: { from, to },
        },
        update: {
          rate: String(persistedRate),
          markup: String(persistedMarkup),
          source: 'admin',
          validUntil: null,
        },
        create: {
          from,
          to,
          rate: String(persistedRate),
          markup: String(persistedMarkup),
          source: 'admin',
          validUntil: null,
        },
      });

      if (adminId) {
        await db.auditLog.create({
          data: {
            adminId,
            action: 'FX_RATE_OVERRIDE',
            targetType: 'Rate',
            targetId: `${from}_${to}`,
            reason: reason || 'Manual rate override',
            before: oldRateValue
              ? {
                  rate: oldRateValue.rate,
                  markup: oldRateValue.markup,
                  source: oldRateValue.source,
                }
              : { rate: null, markup: null },
            after: {
              rate: persistedRate,
              markup: persistedMarkup,
              source: 'admin',
            },
            metadata: { from, to },
          },
        });
      }
    };

    if (database === this.prisma && adminId) {
      await this.prisma.$transaction(async (tx) => {
        await persistRateAndAudit(tx);
      });
    } else {
      await persistRateAndAudit(database);
    }

    // Cache only after the database mutation and its audit record have
    // committed. Redis is a cache and may lag, but it must not expose an
    // unaudited admin rate when the audit write fails.
    if (options.refreshCache !== false) {
      await this.refreshRateCache(from, to, persistedRate, persistedMarkup);
    }

    this.logger.info(
      { from, to, rate: persistedRate, markup: persistedMarkup, adminId },
      'Manual rate set by admin',
    );

    return { rate: persistedRate, markup: persistedMarkup };
  }

  async refreshRateCache(
    from: string,
    to: string,
    rate: number,
    markup: number,
  ): Promise<void> {
    const persistedRate = this.normalizePersistedRate(rate);
    const persistedMarkup = this.normalizePersistedMarkup(markup);
    const cached: CachedRate = {
      rate: persistedRate,
      markup: persistedMarkup,
      fetchedAt: Date.now(),
      source: 'admin',
    };
    this.memoryCache.set(`${from}_${to}`, cached);
    await this.saveToRedis(`${from}_${to}`, cached);
  }

  /**
   * Check if a proposed rate override deviates >5% from current market rate.
   * Used by the admin controller to determine if dual approval is needed.
   */
  async getDeviationFromMarket(
    from: string,
    to: string,
    proposedRate: number,
    proposedMarkup?: number,
  ): Promise<{ deviationPercent: number; requiresDualApproval: boolean }> {
    try {
      const current = await this.getRate(from, to);
      // Compare the *effective* rate (rate * (1 - markup/100)) — the number
      // that actually drives every exchange credit — not just the base rate.
      // Otherwise an admin could hold `rate` at market (0% deviation, no second
      // approver) while inflating `markup` to move the real economics far off
      // market. When no markup is supplied, fall back to base-rate comparison.
      const currentEffective = current.rate * (1 - (current.markup ?? 0) / 100);
      const proposedEffective =
        proposedMarkup === undefined
          ? proposedRate
          : proposedRate * (1 - proposedMarkup / 100);
      const baseline =
        proposedMarkup === undefined ? current.rate : currentEffective;

      if (!baseline || !Number.isFinite(baseline)) {
        return { deviationPercent: 100, requiresDualApproval: true };
      }

      const deviation =
        (Math.abs(proposedEffective - baseline) / baseline) * 100;
      return {
        deviationPercent: Math.round(deviation * 100) / 100,
        requiresDualApproval: deviation > 5,
      };
    } catch {
      // If we can't get current rate, require dual approval as safety measure
      return { deviationPercent: 100, requiresDualApproval: true };
    }
  }

  /**
   * Get current circuit breaker status for monitoring.
   */
  getCircuitStatus(): {
    state: CircuitState;
    failures: number;
    openedAt: number;
  } {
    return {
      state: this.circuitState,
      failures: this.circuitFailures,
      openedAt: this.circuitOpenedAt,
    };
  }

  // ─── Private: Rate Fetching ───────────────────────────────────────

  private async fetchRates(): Promise<void> {
    if (this.usesAdminRates()) return;
    // Circuit breaker check
    if (this.circuitState === 'OPEN') {
      if (Date.now() - this.circuitOpenedAt >= CIRCUIT_RECOVERY_MS) {
        this.circuitState = 'HALF_OPEN';
        this.logger.info({}, 'Circuit breaker half-open — attempting recovery');
      } else {
        this.logger.warn(
          {},
          'Circuit breaker open — skipping rate fetch, serving stale rates',
        );
        return;
      }
    }

    const apiUrl = this.configService.get<string>('FX_API_URL');
    const apiKey = this.configService.get<string>('FX_API_KEY');

    if (!apiUrl || !apiKey) {
      const loadedStoredRates = await this.loadStoredRatesToMemory();
      if (loadedStoredRates) {
        this.logger.warn(
          {},
          'FX Rate API not configured. Using stored exchange rates.',
        );
        return;
      }

      this.logger.warn({}, 'FX Rate API not configured. Using fallback rates.');
      await this.loadFallbackRates();
      return;
    }

    // Fetch rates for both base currencies
    const currencies = ['GHS', 'NGN'] as const;
    let successCount = 0;

    for (const base of currencies) {
      try {
        const url = this.buildApiUrl(apiUrl, apiKey, base);
        const response: AxiosResponse<FxRateResponse> = await firstValueFrom(
          this.httpService.get<FxRateResponse>(url, {
            timeout: 10000,
          }),
        );

        const rates = this.extractRates(response.data, base);
        await this.saveRatesToDatabase(rates, base);
        successCount++;
      } catch (error) {
        this.logger.error(
          {
            base,
            error: 'provider_request_failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
          },
          `Failed to fetch FX rates for ${base}`,
        );
      }
    }

    if (successCount === 0) {
      // All fetches failed
      await this.recordFailure();

      // Try stored rates as fallback
      const hasStoredRates = await this.loadStoredRatesToMemory();
      if (!hasStoredRates) {
        await this.loadFallbackRates();
      }
    } else {
      // At least one succeeded
      await this.recordSuccess();
      this.logger.info(
        { successCount },
        'FX rates fetched and cached successfully',
      );
    }
  }

  private buildApiUrl(baseUrl: string, apiKey: string, base: string): string {
    // exchangerate-api.com format: https://v6.exchangerate-api.com/v6/{KEY}/latest/{BASE}
    if (baseUrl.includes('exchangerate-api.com')) {
      const cleanUrl = baseUrl.replace(/\/+$/, '');
      return `${cleanUrl}/${apiKey}/latest/${base}`;
    }

    // Generic format: append ?base={BASE} or pass apiKey as query param
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}apikey=${apiKey}&base_currency=${base}`;
  }

  private extractRates(
    data: FxRateResponse | null | undefined,
    requestedBase: 'GHS' | 'NGN',
  ): Record<string, number> {
    if (!data || typeof data !== 'object') {
      throw new Error('FX provider returned an empty response');
    }

    const responseBase = this.normalizeCurrency(
      data.base_code || data.base || data.data?.base_code || data.data?.base,
    );
    if (responseBase && responseBase !== requestedBase) {
      throw new Error(
        `FX provider base mismatch: requested ${requestedBase}, received ${responseBase}`,
      );
    }

    if (data.result && data.result.toLowerCase() === 'error') {
      throw new Error('FX provider returned an error response');
    }

    const rawRates =
      data.conversion_rates ??
      data.rates ??
      data.data?.conversion_rates ??
      data.data?.rates;
    if (
      !rawRates ||
      typeof rawRates !== 'object' ||
      Array.isArray(rawRates) ||
      Object.keys(rawRates).length === 0
    ) {
      throw new Error('FX provider returned no rates');
    }

    const target = requestedBase === 'GHS' ? 'NGN' : 'GHS';
    const targetRate = rawRates[target];
    if (!this.isFinitePositiveRate(targetRate)) {
      throw new Error(
        `FX provider returned an invalid ${requestedBase}->${target} rate`,
      );
    }

    return { [target]: targetRate };
  }

  // ─── Private: Circuit Breaker ─────────────────────────────────────

  private async recordSuccess(): Promise<void> {
    this.circuitFailures = 0;
    this.circuitState = 'CLOSED';
    this.circuitOpenedAt = 0;
    await this.persistCircuitState();
  }

  private async recordFailure(): Promise<void> {
    this.circuitFailures++;

    if (
      this.circuitFailures >= CIRCUIT_FAILURE_THRESHOLD &&
      this.circuitState !== 'OPEN'
    ) {
      this.circuitState = 'OPEN';
      this.circuitOpenedAt = Date.now();

      this.logger.error(
        {
          failures: this.circuitFailures,
          threshold: CIRCUIT_FAILURE_THRESHOLD,
        },
        'Circuit breaker OPENED — rate provider is failing',
      );

      // Create audit log entry for admin alert
      try {
        await this.prisma.auditLog.create({
          data: {
            action: 'FX_RATE_CIRCUIT_OPENED',
            targetType: 'RateService',
            targetId: 'circuit-breaker',
            reason: `Circuit opened after ${this.circuitFailures} consecutive failures`,
            metadata: {
              failureCount: this.circuitFailures,
              threshold: CIRCUIT_FAILURE_THRESHOLD,
              openedAt: new Date(this.circuitOpenedAt).toISOString(),
            },
          },
        });
      } catch (auditError) {
        this.logger.error(
          {
            error: 'audit_log_write_failed',
            errorType:
              auditError instanceof Error ? auditError.name : 'UnknownError',
          },
          'Failed to write circuit-breaker audit log',
        );
      }
    }

    await this.persistCircuitState();
  }

  private async restoreCircuitState(): Promise<void> {
    try {
      const state = await this.redis.get(CIRCUIT_REDIS_KEY);
      const failures = await this.redis.get(CIRCUIT_FAILURES_KEY);
      const openedAt = await this.redis.get(CIRCUIT_OPENED_AT_KEY);

      if (state) {
        this.circuitState = state as CircuitState;
      }
      if (failures) {
        this.circuitFailures = parseInt(failures, 10) || 0;
      }
      if (openedAt) {
        this.circuitOpenedAt = parseInt(openedAt, 10) || 0;
      }

      // If circuit was open but recovery time has passed, go half-open
      if (
        this.circuitState === 'OPEN' &&
        Date.now() - this.circuitOpenedAt >= CIRCUIT_RECOVERY_MS
      ) {
        this.circuitState = 'HALF_OPEN';
        this.logger.info({}, 'Circuit breaker restored to half-open state');
      }
    } catch {
      // Keep defaults
    }
  }

  private async persistCircuitState(): Promise<void> {
    await Promise.all([
      this.redis.set(CIRCUIT_REDIS_KEY, this.circuitState, 3600),
      this.redis.set(CIRCUIT_FAILURES_KEY, String(this.circuitFailures), 3600),
      this.redis.set(CIRCUIT_OPENED_AT_KEY, String(this.circuitOpenedAt), 3600),
    ]);
  }

  // ─── Private: Cache Helpers ────────────────────────────────────────

  private isFresh(cached: CachedRate): boolean {
    const now = Date.now();
    const age = now - cached.fetchedAt;

    // fetchedAt is the source timestamp. In particular, it must never be
    // replaced with the time an old DB row was read into memory.
    if (!Number.isFinite(cached.fetchedAt) || age < 0) {
      return false;
    }

    if (cached.source === 'fallback' || age >= RATE_FRESHNESS_TTL_MS) {
      return false;
    }

    if (
      cached.validUntil !== undefined &&
      cached.validUntil !== null &&
      (!Number.isFinite(cached.validUntil) || now >= cached.validUntil)
    ) {
      return false;
    }

    return true;
  }

  private isWithinStaleRetention(cached: CachedRate): boolean {
    const age = Date.now() - cached.fetchedAt;
    return (
      Number.isFinite(cached.fetchedAt) &&
      age >= 0 &&
      age < RATE_STALE_RETENTION_SECONDS * 1000
    );
  }

  private async getStaleRate(key: string): Promise<CachedRate | null> {
    // Try memory cache even if stale
    const memoryCached = this.memoryCache.get(key);
    if (memoryCached && this.isWithinStaleRetention(memoryCached)) {
      return memoryCached;
    }

    // Try Redis (may have longer retention)
    const redisCached = await this.loadFromRedis(key);
    if (redisCached && this.isWithinStaleRetention(redisCached)) {
      return redisCached;
    }

    // Try DB
    const [from, to] = key.split('_');
    const stored = await this.loadStoredRate(from, to);
    return stored && this.isWithinStaleRetention(stored) ? stored : null;
  }

  private async loadFromRedis(key: string): Promise<CachedRate | null> {
    try {
      const raw = await this.redis.get(`${RATE_CACHE_REDIS_PREFIX}${key}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CachedRate>;
        const rate = Number(parsed.rate);
        const markup = Number(parsed.markup);
        const fetchedAt = Number(parsed.fetchedAt);
        const validUntil =
          parsed.validUntil === undefined || parsed.validUntil === null
            ? null
            : Number(parsed.validUntil);

        if (
          !Number.isFinite(rate) ||
          !Number.isFinite(markup) ||
          !Number.isFinite(fetchedAt) ||
          (validUntil !== null && !Number.isFinite(validUntil))
        ) {
          return null;
        }

        return {
          rate,
          markup,
          fetchedAt,
          validUntil,
          source: parsed.source,
        };
      }
    } catch {
      // Redis unavailable
    }
    return null;
  }

  private async saveToRedis(key: string, cached: CachedRate): Promise<void> {
    try {
      await this.redis.set(
        `${RATE_CACHE_REDIS_PREFIX}${key}`,
        JSON.stringify(cached),
        RATE_STALE_RETENTION_SECONDS,
      );
    } catch {
      // Redis unavailable — memory cache is sufficient
    }
  }

  // ─── Private: Database Rate Storage ────────────────────────────────

  private async loadStoredRate(
    from: string,
    to: string,
  ): Promise<CachedRate | null> {
    const stored = await this.prisma.rate.findUnique({
      where: { from_to: { from, to } },
    });

    if (!stored) {
      return null;
    }

    const key = `${from}_${to}`;
    const cached: CachedRate = {
      rate: stored.rate.toNumber(),
      markup: stored.markup.toNumber(),
      // Keep the source timestamp. Reading an old row must not rejuvenate it.
      fetchedAt: stored.updatedAt.getTime(),
      validUntil: stored.validUntil?.getTime() ?? null,
      source: stored.source,
    };
    this.memoryCache.set(key, cached);

    return cached;
  }

  private async loadStoredRatesToMemory(): Promise<boolean> {
    const storedRates = await this.prisma.rate.findMany();
    if (storedRates.length === 0) {
      return false;
    }

    for (const stored of storedRates) {
      this.memoryCache.set(`${stored.from}_${stored.to}`, {
        rate: stored.rate.toNumber(),
        markup: stored.markup.toNumber(),
        // Keep the source timestamp. Reading an old row must not rejuvenate it.
        fetchedAt: stored.updatedAt.getTime(),
        validUntil: stored.validUntil?.getTime() ?? null,
        source: stored.source,
      });
    }

    return true;
  }

  private async loadFallbackRates(): Promise<void> {
    const fallbackRates: Record<string, { rate: number; markup: number }> = {
      NGN_GHS: { rate: 0.315, markup: DEFAULT_MARKUP_PERCENT },
      GHS_NGN: { rate: 3.1746, markup: DEFAULT_MARKUP_PERCENT },
    };

    for (const [pair, { rate, markup }] of Object.entries(fallbackRates)) {
      const [from, to] = pair.split('_');
      const existing = await this.prisma.rate.findUnique({
        where: { from_to: { from, to } },
      });

      if (existing?.source === 'admin') {
        this.memoryCache.set(pair, {
          rate: existing.rate.toNumber(),
          markup: existing.markup.toNumber(),
          fetchedAt: existing.updatedAt.getTime(),
          validUntil: existing.validUntil?.getTime() ?? null,
          source: existing.source,
        });
        continue;
      }

      await this.prisma.rate.upsert({
        where: { from_to: { from, to } },
        update: { rate: String(rate), source: 'fallback' },
        create: {
          from,
          to,
          rate: String(rate),
          markup: String(markup),
          source: 'fallback',
        },
      });

      this.memoryCache.set(pair, {
        rate,
        markup,
        fetchedAt: Date.now(),
        source: 'fallback',
      });
    }

    this.logger.info({}, 'Fallback rates loaded');
  }

  private async saveRatesToDatabase(
    rates: Record<string, number>,
    base: 'GHS' | 'NGN',
  ): Promise<void> {
    const target = base === 'GHS' ? 'NGN' : 'GHS';
    const targetRate = rates[target];
    if (!this.isFinitePositiveRate(targetRate)) {
      throw new Error(`No valid ${base}->${target} rate to persist`);
    }

    // Rate is Decimal(10,4) in Postgres. Normalize before both persistence
    // and caching so a cache hit cannot quote at more precision than a DB
    // reload would use.
    const normalizedRate = this.normalizePersistedRate(targetRate);
    const normalizedInverse = this.normalizePersistedRate(1 / targetRate);

    const ratePairs: Array<{ from: string; to: string; rate: number }> = [
      { from: base, to: target, rate: normalizedRate },
      { from: target, to: base, rate: normalizedInverse },
    ];

    for (const { from, to, rate } of ratePairs) {
      const existing = await this.prisma.rate.findUnique({
        where: { from_to: { from, to } },
      });

      if (existing?.source === 'admin') {
        const key = `${from}_${to}`;
        this.memoryCache.set(key, {
          rate: existing.rate.toNumber(),
          markup: existing.markup.toNumber(),
          fetchedAt: existing.updatedAt.getTime(),
          validUntil: existing.validUntil?.getTime() ?? null,
          source: existing.source,
        });
        continue;
      }

      const effectiveMarkup =
        existing?.source === 'api'
          ? existing.markup.toNumber()
          : DEFAULT_MARKUP_PERCENT;

      const fetchedAt = Date.now();
      const validUntil = new Date(fetchedAt + RATE_FRESHNESS_TTL_MS);

      await this.prisma.rate.upsert({
        where: { from_to: { from, to } },
        update: {
          rate: String(rate),
          source: 'api',
          updatedAt: new Date(fetchedAt),
          validUntil,
        },
        create: {
          from,
          to,
          rate: String(rate),
          markup: String(effectiveMarkup),
          source: 'api',
          validUntil,
        },
      });

      const key = `${from}_${to}`;
      const cached: CachedRate = {
        rate,
        markup: effectiveMarkup,
        fetchedAt,
        validUntil: validUntil.getTime(),
        source: 'api',
      };
      this.memoryCache.set(key, cached);
      await this.saveToRedis(key, cached);
    }

    this.logger.info(
      { pairs: ratePairs.length },
      'Rates saved to database and caches',
    );
  }

  private normalizeCurrency(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim()
      ? value.trim().toUpperCase()
      : undefined;
  }

  private isFinitePositiveRate(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  // This pair's current quote convention is target units per source unit.
  // Reject inverted units; never silently invert an operator's price.
  private isGhanaRateDirectionValid(from: string, to: string, rate: number) {
    if (from === 'NGN' && to === 'GHS') return rate < 1;
    if (from === 'GHS' && to === 'NGN') return rate > 1;
    return true;
  }

  private normalizePersistedRate(value: number): number {
    if (!this.isFinitePositiveRate(value)) {
      throw new Error('FX rate must be finite and positive');
    }

    const normalized = new Decimal(value).toDecimalPlaces(4).toNumber();
    if (!this.isFinitePositiveRate(normalized)) {
      throw new Error('FX rate is not positive at persisted precision');
    }
    return normalized;
  }

  private normalizePersistedMarkup(value: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error('FX markup must be finite and non-negative');
    }
    return new Decimal(value).toDecimalPlaces(2).toNumber();
  }

  // ─── Private: Fallback ─────────────────────────────────────────────

  private getFallbackRate(
    from: string,
    to: string,
  ): { rate: number; markup: number } | null {
    const key = `${from}_${to}`;
    const fallbacks: Record<string, { rate: number; markup: number }> = {
      GHS_NGN: { rate: 3.1746, markup: DEFAULT_MARKUP_PERCENT },
      NGN_GHS: { rate: 0.315, markup: DEFAULT_MARKUP_PERCENT },
    };
    return fallbacks[key] || null;
  }
}
