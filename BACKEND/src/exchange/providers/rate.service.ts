import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { AxiosResponse } from "axios";
import { PinoLogger } from "nestjs-pino";

interface FxRateResponse {
  result?: string;
  base_code?: string;
  rates?: Record<string, number>;
  // Generic fallback shape
  data?: { rates?: Record<string, number> };
}

interface CachedRate {
  rate: number;
  markup: number;
  fetchedAt: number;
}

interface RateResult {
  rate: number;
  markup: number;
  isStale: boolean;
}

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const RATE_CACHE_REDIS_PREFIX = "fx:rate:";
const RATE_FRESHNESS_TTL_MS = 60_000; // 60 seconds freshness
const RATE_STALE_RETENTION_SECONDS = 300; // 5 min Redis retention for stale reads
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RECOVERY_MS = 30_000; // 30 seconds before half-open attempt
const CIRCUIT_REDIS_KEY = "fx:circuit:state";
const CIRCUIT_FAILURES_KEY = "fx:circuit:failures";
const CIRCUIT_OPENED_AT_KEY = "fx:circuit:openedAt";
const DEFAULT_MARKUP_PERCENT = 2.5;

@Injectable()
export class RateService implements OnModuleInit {
  private readonly memoryCache: Map<
    string,
    CachedRate
  > = new Map();

  private circuitState: CircuitState = "CLOSED";
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
    // Restore circuit breaker state from Redis if available
    await this.restoreCircuitState();
    // Warm the cache on startup
    await this.fetchRates();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledRateFetch() {
    this.logger.info({}, "Running scheduled rate fetch (every 60s)");
    await this.fetchRates();
  }

  /**
   * Get the current exchange rate for a currency pair.
   * Returns isStale=true when the circuit is open and a fallback rate is served.
   */
  async getRate(
    from: string,
    to: string,
  ): Promise<RateResult> {
    const key = `${from}_${to}`;

    // Check in-memory cache first (fast path)
    const memoryCached = this.memoryCache.get(key);
    if (memoryCached && this.isFresh(memoryCached.fetchedAt)) {
      return { rate: memoryCached.rate, markup: memoryCached.markup, isStale: false };
    }

    // Try Redis cache (second layer, survives restarts)
    const redisCached = await this.loadFromRedis(key);
    if (redisCached && this.isFresh(redisCached.fetchedAt)) {
      this.memoryCache.set(key, redisCached);
      return { rate: redisCached.rate, markup: redisCached.markup, isStale: false };
    }

    // Try DB stored rate
    const stored = await this.loadStoredRate(from, to);
    if (stored) {
      return { rate: stored.rate, markup: stored.markup, isStale: false };
    }

    // Circuit is open — serve stale rate if available
    if (this.circuitState === "OPEN") {
      const staleRate = await this.getStaleRate(key);
      if (staleRate) {
        this.logger.warn(
          { from, to, rate: staleRate.rate },
          "Circuit OPEN — serving stale rate",
        );
        return { rate: staleRate.rate, markup: staleRate.markup, isStale: true };
      }
    }

    // No cached rate — attempt fetch (respects circuit breaker)
    await this.fetchRates();

    const refreshed = this.memoryCache.get(key);
    if (refreshed) {
      return {
        rate: refreshed.rate,
        markup: refreshed.markup,
        isStale: this.circuitState !== "CLOSED",
      };
    }

    // Last resort: hardcoded fallback rates
    const fallback = this.getFallbackRate(from, to);
    if (fallback) {
      this.logger.error(
        { from, to, rate: fallback.rate },
        "No rate available — using hardcoded fallback",
      );
      return { ...fallback, isStale: true };
    }

    throw new Error(`Rate not available for ${from} to ${to}`);
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
  ): Promise<void> {
    const key = `${from}_${to}`;

    // Get old rate for audit
    const oldRate = await this.prisma.rate.findUnique({
      where: { from_to: { from, to } },
    });

    const oldRateValue = oldRate
      ? { rate: oldRate.rate.toNumber(), markup: oldRate.markup.toNumber() }
      : null;

    await this.prisma.rate.upsert({
      where: {
        from_to: { from, to },
      },
      update: { rate: String(rate), markup: String(markup), source: "admin" },
      create: {
        from,
        to,
        rate: String(rate),
        markup: String(markup),
        source: "admin",
      },
    });

    // Update caches
    const cached: CachedRate = {
      rate,
      markup,
      fetchedAt: Date.now(),
    };
    this.memoryCache.set(key, cached);
    await this.saveToRedis(key, cached);

    // Write audit log
    if (adminId) {
      await this.prisma.auditLog.create({
        data: {
          adminId,
          action: "FX_RATE_OVERRIDE",
          targetType: "Rate",
          targetId: `${from}_${to}`,
          reason: reason || "Manual rate override",
          before: oldRateValue
            ? {
                rate: oldRateValue.rate,
                markup: oldRateValue.markup,
                source: oldRate.source,
              }
            : { rate: null, markup: null },
          after: { rate, markup, source: "admin" },
          metadata: { from, to },
        },
      });
    }

    this.logger.info(
      { from, to, rate, markup, adminId },
      "Manual rate set by admin",
    );
  }

  /**
   * Check if a proposed rate override deviates >5% from current market rate.
   * Used by the admin controller to determine if dual approval is needed.
   */
  async getDeviationFromMarket(
    from: string,
    to: string,
    proposedRate: number,
  ): Promise<{ deviationPercent: number; requiresDualApproval: boolean }> {
    try {
      const current = await this.getRate(from, to);
      const deviation =
        Math.abs(proposedRate - current.rate) / current.rate * 100;
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
    // Circuit breaker check
    if (this.circuitState === "OPEN") {
      if (Date.now() - this.circuitOpenedAt >= CIRCUIT_RECOVERY_MS) {
        this.circuitState = "HALF_OPEN";
        this.logger.info({}, "Circuit breaker half-open — attempting recovery");
      } else {
        this.logger.warn(
          {},
          "Circuit breaker open — skipping rate fetch, serving stale rates",
        );
        return;
      }
    }

    const apiUrl = this.configService.get<string>("FX_API_URL");
    const apiKey = this.configService.get<string>("FX_API_KEY");

    if (!apiUrl || !apiKey) {
      const loadedStoredRates = await this.loadStoredRatesToMemory();
      if (loadedStoredRates) {
        this.logger.warn(
          {},
          "FX Rate API not configured. Using stored exchange rates.",
        );
        return;
      }

      this.logger.warn({}, "FX Rate API not configured. Using fallback rates.");
      await this.loadFallbackRates();
      return;
    }

    // Fetch rates for both base currencies
    const currencies = ["GHS", "NGN"] as const;
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
        if (rates) {
          await this.saveRatesToDatabase(rates);
          successCount++;
        }
      } catch (error) {
        this.logger.error(
          {
            base,
            error: error instanceof Error ? error.message : "Unknown error",
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
        "FX rates fetched and cached successfully",
      );
    }
  }

  private buildApiUrl(
    baseUrl: string,
    apiKey: string,
    base: string,
  ): string {
    // exchangerate-api.com format: https://v6.exchangerate-api.com/v6/{KEY}/latest/{BASE}
    if (baseUrl.includes("exchangerate-api.com")) {
      const cleanUrl = baseUrl.replace(/\/+$/, "");
      return `${cleanUrl}/${apiKey}/latest/${base}`;
    }

    // Generic format: append ?base={BASE} or pass apiKey as query param
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}apikey=${apiKey}&base_currency=${base}`;
  }

  private extractRates(
    data: FxRateResponse,
    base: string,
  ): Record<string, number> | null {
    // exchangerate-api.com format: { result: "success", base_code: "GHS", rates: {...} }
    if (data.result === "success" && data.rates) {
      return data.rates;
    }

    // Direct rates object
    if (data.rates) {
      return data.rates;
    }

    // Nested data.rates
    if (data.data?.rates) {
      return data.data.rates;
    }

    return null;
  }

  // ─── Private: Circuit Breaker ─────────────────────────────────────

  private async recordSuccess(): Promise<void> {
    this.circuitFailures = 0;
    this.circuitState = "CLOSED";
    this.circuitOpenedAt = 0;
    await this.persistCircuitState();
  }

  private async recordFailure(): Promise<void> {
    this.circuitFailures++;

    if (
      this.circuitFailures >= CIRCUIT_FAILURE_THRESHOLD &&
      this.circuitState !== "OPEN"
    ) {
      this.circuitState = "OPEN";
      this.circuitOpenedAt = Date.now();

      this.logger.error(
        {
          failures: this.circuitFailures,
          threshold: CIRCUIT_FAILURE_THRESHOLD,
        },
        "Circuit breaker OPENED — rate provider is failing",
      );

      // Create audit log entry for admin alert
      try {
        await this.prisma.auditLog.create({
          data: {
            action: "FX_RATE_CIRCUIT_OPENED",
            targetType: "RateService",
            targetId: "circuit-breaker",
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
          { error: auditError instanceof Error ? auditError.message : "Unknown" },
          "Failed to write circuit-breaker audit log",
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
        this.circuitState === "OPEN" &&
        Date.now() - this.circuitOpenedAt >= CIRCUIT_RECOVERY_MS
      ) {
        this.circuitState = "HALF_OPEN";
        this.logger.info({}, "Circuit breaker restored to half-open state");
      }
    } catch {
      // Keep defaults
    }
  }

  private async persistCircuitState(): Promise<void> {
    await Promise.all([
      this.redis.set(CIRCUIT_REDIS_KEY, this.circuitState, 3600),
      this.redis.set(
        CIRCUIT_FAILURES_KEY,
        String(this.circuitFailures),
        3600,
      ),
      this.redis.set(
        CIRCUIT_OPENED_AT_KEY,
        String(this.circuitOpenedAt),
        3600,
      ),
    ]);
  }

  // ─── Private: Cache Helpers ────────────────────────────────────────

  private isFresh(fetchedAt: number): boolean {
    return Date.now() - fetchedAt < RATE_FRESHNESS_TTL_MS;
  }

  private async getStaleRate(
    key: string,
  ): Promise<{ rate: number; markup: number } | null> {
    // Try memory cache even if stale
    const memoryCached = this.memoryCache.get(key);
    if (memoryCached) {
      return { rate: memoryCached.rate, markup: memoryCached.markup };
    }

    // Try Redis (may have longer retention)
    const redisCached = await this.loadFromRedis(key);
    if (redisCached) {
      return { rate: redisCached.rate, markup: redisCached.markup };
    }

    // Try DB
    const [from, to] = key.split("_");
    return this.loadStoredRate(from, to);
  }

  private async loadFromRedis(key: string): Promise<CachedRate | null> {
    try {
      const raw = await this.redis.get(`${RATE_CACHE_REDIS_PREFIX}${key}`);
      if (raw) {
        return JSON.parse(raw) as CachedRate;
      }
    } catch {
      // Redis unavailable
    }
    return null;
  }

  private async saveToRedis(
    key: string,
    cached: CachedRate,
  ): Promise<void> {
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
  ): Promise<{ rate: number; markup: number } | null> {
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
      fetchedAt: Date.now(),
    };
    this.memoryCache.set(key, cached);

    return { rate: cached.rate, markup: cached.markup };
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
        fetchedAt: Date.now(),
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
      const [from, to] = pair.split("_");
      const existing = await this.prisma.rate.findUnique({
        where: { from_to: { from, to } },
      });

      if (existing?.source === "admin") {
        this.memoryCache.set(pair, {
          rate: existing.rate.toNumber(),
          markup: existing.markup.toNumber(),
          fetchedAt: Date.now(),
        });
        continue;
      }

      await this.prisma.rate.upsert({
        where: { from_to: { from, to } },
        update: { rate: String(rate), source: "fallback" },
        create: {
          from,
          to,
          rate: String(rate),
          markup: String(markup),
          source: "fallback",
        },
      });

      this.memoryCache.set(pair, {
        rate,
        markup,
        fetchedAt: Date.now(),
      });
    }

    this.logger.info({}, "Fallback rates loaded");
  }

  private async saveRatesToDatabase(
    rates: Record<string, number>,
  ): Promise<void> {
    // Derive both pairs from the fetched rates
    // If we fetched with base=GHS, rates contains GHS→NGN directly
    // We also compute NGN→GHS as the inverse
    const ghsToNgn = rates["NGN"]; // When base=GHS, NGN rate = GHS→NGN
    const ngnToGhs = rates["GHS"]; // When base=NGN, GHS rate = NGN→GHS

    const ratePairs: Array<{ from: string; to: string; rate: number }> = [];

    if (ghsToNgn && ghsToNgn > 0) {
      ratePairs.push({ from: "GHS", to: "NGN", rate: ghsToNgn });
      // Compute inverse
      ratePairs.push({ from: "NGN", to: "GHS", rate: 1 / ghsToNgn });
    }

    if (ngnToGhs && ngnToGhs > 0) {
      // Don't duplicate NGN→GHS if already added from inverse
      if (!ratePairs.some((p) => p.from === "NGN" && p.to === "GHS")) {
        ratePairs.push({ from: "NGN", to: "GHS", rate: ngnToGhs });
      }
      if (!ratePairs.some((p) => p.from === "GHS" && p.to === "NGN")) {
        ratePairs.push({ from: "GHS", to: "NGN", rate: 1 / ngnToGhs });
      }
    }

    for (const { from, to, rate } of ratePairs) {
      const existing = await this.prisma.rate.findUnique({
        where: { from_to: { from, to } },
      });

      if (existing?.source === "admin") {
        const key = `${from}_${to}`;
        this.memoryCache.set(key, {
          rate: existing.rate.toNumber(),
          markup: existing.markup.toNumber(),
          fetchedAt: Date.now(),
        });
        continue;
      }

      const effectiveMarkup = existing?.source === "api"
        ? existing.markup.toNumber()
        : DEFAULT_MARKUP_PERCENT;

      await this.prisma.rate.upsert({
        where: { from_to: { from, to } },
        update: { rate: String(rate), source: "api", updatedAt: new Date() },
        create: {
          from,
          to,
          rate: String(rate),
          markup: String(effectiveMarkup),
          source: "api",
        },
      });

      const key = `${from}_${to}`;
      const cached: CachedRate = {
        rate,
        markup: effectiveMarkup,
        fetchedAt: Date.now(),
      };
      this.memoryCache.set(key, cached);
      await this.saveToRedis(key, cached);
    }

    this.logger.info(
      { pairs: ratePairs.length },
      "Rates saved to database and caches",
    );
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
