import {
  BadRequestException,
  ConflictException,
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
import { DEFAULT_RATE_QUOTE_BASIS, RateQuoteBasis } from '../rate.types';

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
  /** Canonical target units per source unit used by quote/execution code. */
  rate: number;
  /** Original admin/provider input, in the persisted quote basis. */
  inputRate: number;
  quoteBasis: RateQuoteBasis;
  markup: number;
  fetchedAt: number;
  /** Absolute expiry copied from the persisted rate when available. */
  validUntil?: number | null;
  /** Fallback rates are display-only and must never be treated as executable. */
  source?: string;
}

export interface RatePairSafety {
  safe: boolean;
  oppositeEffectiveRate: string;
  maximumEffectiveRate: string;
}

export class AdminExchangeRatePairConflictException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'EXCHANGE_RATE_PAIR_CONFLICT',
      message: 'Exchange pricing is being updated. Please try again shortly.',
    });
  }
}

interface RateResult {
  pairSafety?: RatePairSafety;
  /** Canonical target units per source unit. */
  rate: number;
  /** Original persisted/admin input value. */
  inputRate: number;
  quoteBasis: RateQuoteBasis;
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
const CANONICAL_RATE_DECIMAL_PLACES = 6;
// Preserve tiny excesses above one when checking two effective prices.
const PairDecimal = Decimal.clone({ precision: 40 });

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
  async getRate(
    from: string,
    to: string,
    options: { forDisplay?: boolean } = {},
  ): Promise<RateResult> {
    if (this.usesAdminRates())
      return this.getAdminRate(from, to, options.forDisplay);
    const key = `${from}_${to}`;

    // Check in-memory cache first (fast path)
    const memoryCached = this.memoryCache.get(key);
    if (memoryCached && this.isFresh(memoryCached)) {
      return this.toRateResult(memoryCached, false);
    }

    // Try Redis cache (second layer, survives restarts)
    const redisCached = await this.loadFromRedis(key);
    if (redisCached && this.isFresh(redisCached)) {
      this.memoryCache.set(key, redisCached);
      return this.toRateResult(redisCached, false);
    }

    // Try DB stored rate
    const stored = await this.loadStoredRate(from, to);
    if (stored && this.isFresh(stored)) {
      return this.toRateResult(stored, false);
    }

    // Circuit is open — serve stale rate if available
    if (this.circuitState === 'OPEN') {
      const staleRate = await this.getStaleRate(key);
      if (staleRate) {
        this.logger.warn(
          { from, to, rate: staleRate.rate },
          'Circuit OPEN — serving stale rate',
        );
        return this.toRateResult(staleRate, true);
      }
    }

    // No cached rate — attempt fetch (respects circuit breaker)
    await this.fetchRates();

    const refreshed = this.memoryCache.get(key);
    if (refreshed && this.isFresh(refreshed)) {
      return this.toRateResult(refreshed, false);
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
      return this.toRateResult(staleRate, true);
    }

    // Last resort: hardcoded fallback rates
    const fallback = this.getFallbackRate(from, to);
    if (fallback) {
      this.logger.error(
        { from, to, rate: fallback.rate },
        'No rate available — using hardcoded fallback',
      );
      return {
        rate: fallback.rate,
        inputRate: fallback.rate,
        quoteBasis: DEFAULT_RATE_QUOTE_BASIS,
        markup: fallback.markup,
        isStale: true,
      };
    }

    throw new Error(`Rate not available for ${from} to ${to}`);
  }

  private usesAdminRates(): boolean {
    return (
      (this.configService.get<string>('FX_RATE_SOURCE') ?? 'admin') !== 'api'
    );
  }

  private async getAdminRate(
    from: string,
    to: string,
    forDisplay = false,
    database: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<RateResult> {
    // The database is authoritative: another admin/process may have changed
    // the price. Do not substitute an API value or an old Redis/memory entry.
    const stored = await database.rate.findUnique({
      where: { from_to: { from, to } },
    });
    const inputRate = stored?.rate.toNumber();
    const quoteBasis = this.readQuoteBasis(stored?.quoteBasis);
    const rate = this.isFinitePositiveRate(inputRate)
      ? this.toCanonicalRate(inputRate, quoteBasis)
      : undefined;
    const markup = stored?.markup.toNumber();
    const expiry = stored?.validUntil?.getTime();
    if (
      stored?.source !== 'admin' ||
      !this.isFinitePositiveRate(inputRate) ||
      !this.isGhanaRateDirectionValid(from, to, inputRate, quoteBasis) ||
      !this.isFinitePositiveRate(rate) ||
      markup === undefined ||
      !Number.isFinite(markup) ||
      markup < 0 ||
      markup >= 100 ||
      (expiry !== undefined &&
        (!Number.isFinite(expiry) || expiry <= Date.now()))
    )
      throw new AdminExchangeRateNotSetException();
    const pairSafety = await this.getPairSafety(
      database,
      from,
      to,
      rate,
      markup,
    );
    if (pairSafety && !pairSafety.safe && !forDisplay) {
      throw new AdminExchangeRatePairConflictException();
    }
    // Admin prices stay active until replaced or explicitly expired. The
    // short market-feed freshness window applies only to API mode.
    return {
      rate,
      inputRate,
      quoteBasis,
      markup,
      isStale: false,
      ...(pairSafety ? { pairSafety } : {}),
    };
  }

  private async getPairSafety(
    db: PrismaService | Prisma.TransactionClient,
    from: string,
    to: string,
    canonicalRate: number,
    markup: number,
  ): Promise<RatePairSafety | undefined> {
    const [opposite] = await db.rate.findMany({
      where: { from: to, to: from, source: 'admin' },
      take: 1,
    });
    // An unavailable reverse direction cannot issue a quote. Enabling or
    // replacing it goes through this same pair check before it can be saved.
    if (
      !opposite ||
      opposite.source !== 'admin' ||
      (opposite.validUntil && opposite.validUntil.getTime() <= Date.now())
    )
      return;
    const input = opposite.rate.toNumber();
    const oppositeMarkup = opposite.markup.toNumber();
    const basis = this.readQuoteBasis(opposite.quoteBasis);
    if (
      !this.isFinitePositiveRate(input) ||
      !this.isGhanaRateDirectionValid(to, from, input, basis) ||
      !Number.isFinite(oppositeMarkup) ||
      oppositeMarkup < 0 ||
      oppositeMarkup >= 100
    )
      return;
    const oppositeCanonical = this.toCanonicalRate(input, basis);
    const effective = new PairDecimal(String(canonicalRate)).mul(
      new PairDecimal(1).minus(new PairDecimal(String(markup)).div(100)),
    );
    const reverse = new PairDecimal(String(oppositeCanonical)).mul(
      new PairDecimal(1).minus(
        new PairDecimal(String(oppositeMarkup)).div(100),
      ),
    );
    return {
      safe: effective.mul(reverse).lte(1),
      oppositeEffectiveRate: reverse.toString(),
      maximumEffectiveRate: new PairDecimal(1)
        .div(reverse)
        .toDecimalPlaces(12, PairDecimal.ROUND_DOWN)
        .toString(),
    };
  }

  private toRateResult(cached: CachedRate, isStale: boolean): RateResult {
    return {
      rate: cached.rate,
      inputRate: cached.inputRate,
      quoteBasis: cached.quoteBasis,
      markup: cached.markup,
      isStale,
    };
  }

  /** Called inside the first money transaction, before wallet/user locks. */
  async assertQuoteSafe(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
    frozenRate: string | number,
  ): Promise<void> {
    if (!this.usesAdminRates()) return;
    const pairKey = `trustpay:admin-fx:${[from, to].sort().join(':')}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${pairKey}))`;
    try {
      // Row locks also detect a stale Serializable snapshot after waiting
      // for an admin writer. They protect against direct database updates.
      await tx.$queryRaw`SELECT "id" FROM "rates"
        WHERE ("from" = ${from} AND "to" = ${to}) OR ("from" = ${to} AND "to" = ${from})
        ORDER BY "from", "to" FOR SHARE`;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' && error.meta?.code === '40001'))
      ) {
        throw new ConflictException(
          'Exchange pricing changed. Request a new quote.',
        );
      }
      throw error;
    }
    const current = await this.getAdminRate(from, to, false, tx);
    const effective = new PairDecimal(String(current.rate)).mul(
      new PairDecimal(1).minus(
        new PairDecimal(String(current.markup)).div(100),
      ),
    );
    const frozen = new PairDecimal(String(frozenRate));
    // Requiring no more than the current own-leg price also stops two
    // different old quotes from combining more generous historical terms.
    if (!frozen.isFinite() || frozen.lte(0) || frozen.gt(effective)) {
      throw new ConflictException(
        'This quote price changed. Request a new quote.',
      );
    }
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
    options: {
      refreshCache?: boolean;
      quoteBasis?: RateQuoteBasis;
    } = {},
  ): Promise<{
    /** Raw value entered by the administrator, retained for compatibility. */
    rate: number;
    inputRate: number;
    quoteBasis: RateQuoteBasis;
    /** Canonical target-per-source multiplier used by all customer quotes. */
    canonicalRate: number;
    markup: number;
    effectiveRate: number;
  }> {
    const quoteBasis = this.readQuoteBasis(options.quoteBasis);
    const persistedRate = this.normalizePersistedRate(rate);
    if (!this.isGhanaRateDirectionValid(from, to, persistedRate, quoteBasis)) {
      throw new BadRequestException(
        quoteBasis === 'SOURCE_PER_TARGET'
          ? 'Rate direction is invalid for the selected source-per-target units.'
          : 'Rate direction is invalid. Enter GHS received per 1 NGN (below 1), or NGN received per 1 GHS (above 1).',
      );
    }
    const persistedMarkup = this.normalizePersistedMarkup(markup);
    const canonicalRate = this.toCanonicalRate(persistedRate, quoteBasis);
    const effectiveRate = this.calculateEffectiveRate(
      canonicalRate,
      persistedMarkup,
    );

    const persistRateAndAudit = async (
      db: PrismaService | Prisma.TransactionClient,
    ) => {
      // Serialize both directions, including first insert, before reading
      // either row. The transaction also contains the price and its audit.
      const pairKey = `trustpay:admin-fx:${[from, to].sort().join(':')}`;
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pairKey}))`;
      const safety = await this.getPairSafety(
        db,
        from,
        to,
        canonicalRate,
        persistedMarkup,
      );
      if (safety && !safety.safe) {
        throw new BadRequestException({
          code: 'EXCHANGE_RATE_PAIR_CONFLICT',
          message:
            'These rates allow a profitable round trip. Reduce this payout rate or adjust the opposite rate in the admin dashboard.',
        });
      }
      // Get the old rate and write the new rate/audit record in one DB
      // transaction for direct admin overrides. The dual-approval path passes
      // its existing transaction client and writes its review audit there.
      const oldRate = await db.rate.findUnique({
        where: { from_to: { from, to } },
      });

      const oldRateValue = oldRate
        ? {
            rate: oldRate.rate.toNumber(),
            inputRate: oldRate.rate.toNumber(),
            quoteBasis: this.readQuoteBasis(oldRate.quoteBasis),
            canonicalRate: this.toCanonicalRate(
              oldRate.rate.toNumber(),
              this.readQuoteBasis(oldRate.quoteBasis),
            ),
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
          quoteBasis,
          source: 'admin',
          validUntil: null,
        },
        create: {
          from,
          to,
          rate: String(persistedRate),
          markup: String(persistedMarkup),
          quoteBasis,
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
                  inputRate: oldRateValue.inputRate,
                  canonicalRate: oldRateValue.canonicalRate,
                  markup: oldRateValue.markup,
                  quoteBasis: oldRateValue.quoteBasis,
                  source: oldRateValue.source,
                }
              : {
                  rate: null,
                  inputRate: null,
                  canonicalRate: null,
                  markup: null,
                  quoteBasis: null,
                },
            after: {
              rate: persistedRate,
              inputRate: persistedRate,
              canonicalRate,
              markup: persistedMarkup,
              quoteBasis,
              source: 'admin',
            },
            metadata: { from, to },
          },
        });
      }
    };

    if (database === this.prisma) {
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
      await this.refreshRateCache(
        from,
        to,
        persistedRate,
        persistedMarkup,
        quoteBasis,
      );
    }

    this.logger.info(
      {
        from,
        to,
        rate: persistedRate,
        canonicalRate,
        quoteBasis,
        markup: persistedMarkup,
        adminId,
      },
      'Manual rate set by admin',
    );

    return {
      rate: persistedRate,
      inputRate: persistedRate,
      quoteBasis,
      canonicalRate,
      markup: persistedMarkup,
      effectiveRate,
    };
  }

  async refreshRateCache(
    from: string,
    to: string,
    rate: number,
    markup: number,
    quoteBasis: RateQuoteBasis = DEFAULT_RATE_QUOTE_BASIS,
  ): Promise<void> {
    const normalizedBasis = this.readQuoteBasis(quoteBasis);
    const persistedRate = this.normalizePersistedRate(rate);
    const persistedMarkup = this.normalizePersistedMarkup(markup);
    const canonicalRate = this.toCanonicalRate(persistedRate, normalizedBasis);
    const cached: CachedRate = {
      rate: canonicalRate,
      inputRate: persistedRate,
      quoteBasis: normalizedBasis,
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
        const inputRate = Number(parsed.inputRate ?? parsed.rate);
        const quoteBasis = this.readQuoteBasis(parsed.quoteBasis);
        const markup = Number(parsed.markup);
        const fetchedAt = Number(parsed.fetchedAt);
        const validUntil =
          parsed.validUntil === undefined || parsed.validUntil === null
            ? null
            : Number(parsed.validUntil);

        if (
          !Number.isFinite(rate) ||
          !Number.isFinite(inputRate) ||
          !Number.isFinite(markup) ||
          !Number.isFinite(fetchedAt) ||
          (validUntil !== null && !Number.isFinite(validUntil))
        ) {
          return null;
        }

        return {
          rate,
          inputRate,
          quoteBasis,
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
    const inputRate = stored.rate.toNumber();
    const quoteBasis = this.readQuoteBasis(stored.quoteBasis);
    const cached: CachedRate = {
      rate: this.toCanonicalRate(inputRate, quoteBasis),
      inputRate,
      quoteBasis,
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
      const inputRate = stored.rate.toNumber();
      const quoteBasis = this.readQuoteBasis(stored.quoteBasis);
      this.memoryCache.set(`${stored.from}_${stored.to}`, {
        rate: this.toCanonicalRate(inputRate, quoteBasis),
        inputRate,
        quoteBasis,
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
        const inputRate = existing.rate.toNumber();
        const quoteBasis = this.readQuoteBasis(existing.quoteBasis);
        this.memoryCache.set(pair, {
          rate: this.toCanonicalRate(inputRate, quoteBasis),
          inputRate,
          quoteBasis,
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
        inputRate: rate,
        quoteBasis: DEFAULT_RATE_QUOTE_BASIS,
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
        const inputRate = existing.rate.toNumber();
        const quoteBasis = this.readQuoteBasis(existing.quoteBasis);
        const key = `${from}_${to}`;
        this.memoryCache.set(key, {
          rate: this.toCanonicalRate(inputRate, quoteBasis),
          inputRate,
          quoteBasis,
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
        inputRate: rate,
        quoteBasis: DEFAULT_RATE_QUOTE_BASIS,
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

  /**
   * Validate the operator's entered units without silently changing the
   * configured business price. The canonical customer multiplier is always
   * target-per-source, but SOURCE_PER_TARGET deliberately reverses the
   * expected magnitude of the raw input.
   */
  private isGhanaRateDirectionValid(
    from: string,
    to: string,
    rate: number,
    quoteBasis: RateQuoteBasis = DEFAULT_RATE_QUOTE_BASIS,
  ) {
    if (from === 'NGN' && to === 'GHS') {
      return quoteBasis === 'SOURCE_PER_TARGET' ? rate > 1 : rate < 1;
    }
    if (from === 'GHS' && to === 'NGN') {
      return quoteBasis === 'SOURCE_PER_TARGET' ? rate < 1 : rate > 1;
    }
    return true;
  }

  private readQuoteBasis(value: unknown): RateQuoteBasis {
    if (
      value === undefined ||
      value === null ||
      value === 'TARGET_PER_SOURCE'
    ) {
      return DEFAULT_RATE_QUOTE_BASIS;
    }
    if (value === 'SOURCE_PER_TARGET') return 'SOURCE_PER_TARGET';
    throw new BadRequestException('quoteBasis must be a supported rate unit');
  }

  /**
   * Convert an entered/persisted value to the only unit accepted by quote and
   * execution code. Reciprocal precision is intentionally kept above the
   * persisted Decimal(10,4) scale. The six-decimal canonical precision matches
   * the frozen manual-quote rate precision; rounding it back to four places
   * would turn 1/87 into .0115 and materially change the customer quote.
   */
  private toCanonicalRate(
    inputRate: number | undefined,
    quoteBasis: RateQuoteBasis,
  ): number {
    if (!this.isFinitePositiveRate(inputRate)) {
      throw new Error('FX rate must be finite and positive');
    }

    if (quoteBasis === 'TARGET_PER_SOURCE') {
      return inputRate;
    }

    const reciprocal = new Decimal(1)
      .div(inputRate)
      .toDecimalPlaces(CANONICAL_RATE_DECIMAL_PLACES, Decimal.ROUND_DOWN)
      .toNumber();
    if (!this.isFinitePositiveRate(reciprocal)) {
      throw new Error('FX rate reciprocal is not positive');
    }
    return reciprocal;
  }

  private calculateEffectiveRate(rate: number, markup: number): number {
    return new Decimal(rate)
      .mul(new Decimal(1).minus(new Decimal(markup).div(100)))
      .toDecimalPlaces(12)
      .toNumber();
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
