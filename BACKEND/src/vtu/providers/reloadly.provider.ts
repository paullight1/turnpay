import { BadRequestException, Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { firstValueFrom } from "rxjs";
import { RedisService } from "../../redis/redis.service";
import { VtuProvider } from "./vtu-api.provider";
import { VtuProviderHealth } from "./provider-health.types";

interface ReloadlyTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface ReloadlyOperator {
  operatorId: number;
  name: string;
  bundle?: boolean;
  data?: boolean;
  pin?: boolean;
  supportsLocalAmounts?: boolean;
  senderCurrencyCode?: string;
  destinationCurrencyCode?: string;
}

interface ReloadlyTopupResponse {
  transactionId?: number;
  operatorTransactionId?: string;
  customIdentifier?: string;
  status?: string;
  message?: string;
}

interface ReloadlyBalanceResponse {
  balance?: number | string;
  amount?: number | string;
  currencyCode?: string;
  currency?: string;
}

interface ReloadlyBiller {
  id?: number;
  billerId?: number;
  name?: string;
  billerName?: string;
  type?: string;
  serviceType?: string;
  countryISOCode?: string;
  billerCountryCode?: string;
}

interface ReloadlyUtilityTransactionResponse {
  id?: number;
  transactionId?: number;
  referenceId?: string;
  status?: string;
  message?: string;
  billDetails?: {
    billerReferenceId?: string;
    billerName?: string;
    pinDetails?: unknown;
  };
}

export interface ReloadlyProviderResult {
  reference: string;
  status: string;
  message: string;
  providerRequestId?: string;
  rawResponse?: Record<string, unknown>;
}

export interface ReloadlyDetectedOperator extends VtuProvider {
  countryCode: string;
}

@Injectable()
export class ReloadlyProvider {
  private readonly authUrl: string;
  private readonly baseUrl: string;
  private readonly audience: string;
  private readonly utilitiesBaseUrl: string;
  private readonly utilitiesAudience: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly senderCountryCode: string;
  private readonly enabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.authUrl =
      this.configService.get<string>("RELOADLY_AUTH_URL") ||
      "https://auth.reloadly.com/oauth/token";
    this.baseUrl =
      this.configService.get<string>("RELOADLY_TOPUPS_BASE_URL") ||
      "https://topups-sandbox.reloadly.com";
    this.audience =
      this.configService.get<string>("RELOADLY_AUDIENCE") ||
      this.baseUrl.replace(/\/$/, "");
    this.utilitiesBaseUrl =
      this.configService.get<string>("RELOADLY_UTILITIES_BASE_URL") ||
      "https://utilities-sandbox.reloadly.com";
    this.utilitiesAudience =
      this.configService.get<string>("RELOADLY_UTILITIES_AUDIENCE") ||
      this.utilitiesBaseUrl.replace(/\/$/, "");
    this.clientId = this.configService.get<string>("RELOADLY_CLIENT_ID") || "";
    this.clientSecret =
      this.configService.get<string>("RELOADLY_CLIENT_SECRET") || "";
    this.senderCountryCode =
      this.configService.get<string>("RELOADLY_SENDER_COUNTRY_CODE") || "NG";
    this.enabled =
      this.configService.get<string>("RELOADLY_ENABLED", "false") === "true";
    this.logger.setContext(ReloadlyProvider.name);

    if (
      this.configService.get<string>("NODE_ENV") === "production" &&
      this.enabled &&
      (!this.clientId || !this.clientSecret)
    ) {
      throw new Error("Reloadly credentials are not configured");
    }
  }

  async getOperators(
    countryCode?: string,
    serviceType: "airtime" | "data" = "airtime",
  ): Promise<VtuProvider[]> {
    if (this.isLiveDisabled()) {
      return [];
    }

    if (this.shouldUseSimulation()) {
      return this.getFallbackOperators(countryCode, serviceType);
    }

    try {
      const token = await this.getTopupsAccessToken();
      const response = await firstValueFrom(
        this.httpService.get<ReloadlyOperator[]>(
          countryCode
            ? `${this.baseUrl}/operators/countries/${countryCode}`
            : `${this.baseUrl}/operators`,
          {
            headers: this.authHeaders(token),
          },
        ),
      );

      return response.data
        .filter((operator) => serviceType !== "data" || operator.data)
        .map((operator) => ({
          id: String(operator.operatorId),
          name: operator.name,
          type: serviceType,
          isActive: true,
        }));
    } catch {
      this.logger.warn("Reloadly operators unavailable, using fallback list");
      return this.getFallbackOperators(countryCode, serviceType);
    }
  }

  async autoDetectOperator(params: {
    phone: string;
    countryCode: string;
    type: "airtime" | "data";
  }): Promise<ReloadlyDetectedOperator | null> {
    if (this.isLiveDisabled()) {
      return null;
    }

    if (this.shouldUseSimulation()) {
      const [operator] = this.getFallbackOperators(
        params.countryCode,
        params.type,
      );
      return operator ? { ...operator, countryCode: params.countryCode } : null;
    }

    try {
      const token = await this.getTopupsAccessToken();
      const response = await firstValueFrom(
        this.httpService.get<ReloadlyOperator>(
          `${this.baseUrl}/operators/auto-detect/phone/${encodeURIComponent(
            params.phone,
          )}/countries/${encodeURIComponent(params.countryCode)}`,
          { headers: this.authHeaders(token) },
        ),
      );

      if (params.type === "data" && !response.data.data) {
        return null;
      }

      return this.toDetectedOperator(response.data, params);
    } catch {
      this.logger.warn("Reloadly operator auto-detect unavailable");
      return null;
    }
  }

  async getUtilityBillers(
    countryCode?: string,
    serviceType: "electricity" = "electricity",
  ): Promise<VtuProvider[]> {
    if (this.isLiveDisabled()) {
      return [];
    }

    if (this.shouldUseSimulation()) {
      return this.getFallbackUtilityBillers(countryCode, serviceType);
    }

    try {
      const token = await this.getUtilitiesAccessToken();
      const params = new URLSearchParams({
        type: this.utilityBillerType(serviceType),
        page: "1",
        size: "50",
      });
      if (countryCode) {
        params.set("countryISOCode", countryCode);
      }

      const response = await firstValueFrom(
        this.httpService.get<ReloadlyBiller[] | { content?: ReloadlyBiller[] }>(
          `${this.utilitiesBaseUrl}/billers?${params.toString()}`,
          { headers: this.utilityAuthHeaders(token) },
        ),
      );

      return this.extractList<ReloadlyBiller>(response.data)
        .map((biller) => this.toUtilityProvider(biller, serviceType))
        .filter((provider): provider is VtuProvider => Boolean(provider));
    } catch {
      this.logger.warn(
        "Reloadly utility billers unavailable, using fallback list",
      );
      return this.getFallbackUtilityBillers(countryCode, serviceType);
    }
  }

  async purchase(params: {
    type: "airtime" | "data";
    operatorId: string;
    countryCode: string;
    recipientNumber: string;
    amount: number;
    reference: string;
  }): Promise<ReloadlyProviderResult> {
    this.assertReadyForPurchase();

    if (this.shouldUseSimulation()) {
      return {
        reference: params.reference,
        status: "success",
        message: `International ${params.type} purchase simulated successfully`,
        providerRequestId: params.reference,
      };
    }

    const token = await this.getTopupsAccessToken();
    const payload = {
      operatorId: Number(params.operatorId),
      amount: params.amount,
      useLocalAmount: false,
      customIdentifier: params.reference,
      recipientPhone: {
        countryCode: params.countryCode,
        number: params.recipientNumber,
      },
      senderPhone: {
        countryCode: this.senderCountryCode,
        number: "0000000000",
      },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<ReloadlyTopupResponse>(
          `${this.baseUrl}/topups`,
          payload,
          {
            headers: this.authHeaders(token),
          },
        ),
      );

      return {
        reference:
          response.data.transactionId?.toString() ||
          response.data.operatorTransactionId ||
          response.data.customIdentifier ||
          params.reference,
        status: this.normalizeStatus(response.data.status),
        message: response.data.message || "Reloadly top-up submitted",
        providerRequestId: params.reference,
        rawResponse: response.data as unknown as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        "Reloadly purchase request failed with unknown provider result",
      );
      throw new Error("Reloadly provider result unknown");
    }
  }

  async payUtilityBill(params: {
    type: "electricity";
    billerId: string;
    countryCode: string;
    meterNumber: string;
    amount: number;
    reference: string;
  }): Promise<ReloadlyProviderResult> {
    this.assertReadyForPurchase();

    if (this.shouldUseSimulation()) {
      return {
        reference: params.reference,
        status: "success",
        message: "International electricity payment simulated successfully",
        providerRequestId: params.reference,
      };
    }

    const token = await this.getUtilitiesAccessToken();
    const payload = {
      subscriberAccountNumber: params.meterNumber,
      amount: params.amount,
      billerId: Number(params.billerId),
      useLocalAmount: false,
      referenceId: params.reference,
      additionalInfo: {
        invoiceId: null,
      },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<ReloadlyUtilityTransactionResponse>(
          `${this.utilitiesBaseUrl}/pay`,
          payload,
          { headers: this.utilityAuthHeaders(token) },
        ),
      );

      return this.toUtilityResult(
        response.data,
        params.reference,
        "Reloadly utility payment submitted",
      );
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        "Reloadly utility payment failed with unknown provider result",
      );
      throw new Error("Reloadly utility provider result unknown");
    }
  }

  async requery(transactionId: string): Promise<ReloadlyProviderResult> {
    return this.getTopupStatus(transactionId);
  }

  async requeryUtilityPayment(
    referenceId: string,
  ): Promise<ReloadlyProviderResult> {
    return this.getUtilityPaymentStatus(referenceId);
  }

  async getTopupStatus(transactionId: string): Promise<ReloadlyProviderResult> {
    if (this.shouldUseSimulation()) {
      return {
        reference: transactionId,
        status: "pending",
        message: "Reloadly status lookup simulated",
      };
    }

    if (this.isLiveDisabled()) {
      throw new BadRequestException("Reloadly provider is not enabled");
    }

    if (!this.hasCredentials()) {
      throw new BadRequestException("Reloadly credentials are not configured");
    }

    const token = await this.getTopupsAccessToken();

    try {
      const response = await firstValueFrom(
        this.httpService.get<ReloadlyTopupResponse>(
          `${this.baseUrl}/topups/${encodeURIComponent(transactionId)}/status`,
          { headers: this.authHeaders(token) },
        ),
      );

      return {
        reference:
          response.data.transactionId?.toString() ||
          response.data.operatorTransactionId ||
          response.data.customIdentifier ||
          transactionId,
        status: this.normalizeStatus(response.data.status),
        message: response.data.message || "Reloadly top-up status checked",
        providerRequestId: response.data.customIdentifier,
        rawResponse: response.data as unknown as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        "Reloadly requery failed with unknown provider result",
      );
      throw new Error("Reloadly provider result unknown");
    }
  }

  async getUtilityPaymentStatus(
    referenceId: string,
  ): Promise<ReloadlyProviderResult> {
    if (this.shouldUseSimulation()) {
      return {
        reference: referenceId,
        status: "pending",
        message: "Reloadly utility status lookup simulated",
        providerRequestId: referenceId,
      };
    }

    if (this.isLiveDisabled()) {
      throw new BadRequestException("Reloadly provider is not enabled");
    }

    if (!this.hasCredentials()) {
      throw new BadRequestException("Reloadly credentials are not configured");
    }

    const token = await this.getUtilitiesAccessToken();
    const params = new URLSearchParams({
      referenceId,
      page: "1",
      size: "1",
    });

    try {
      const response = await firstValueFrom(
        this.httpService.get<
          | ReloadlyUtilityTransactionResponse[]
          | { content?: ReloadlyUtilityTransactionResponse[] }
        >(`${this.utilitiesBaseUrl}/transactions?${params.toString()}`, {
          headers: this.utilityAuthHeaders(token),
        }),
      );
      const [transaction] = this.extractList(response.data);

      if (!transaction) {
        return {
          reference: referenceId,
          status: "pending",
          message: "Reloadly utility transaction is not available yet",
          providerRequestId: referenceId,
        };
      }

      return this.toUtilityResult(
        transaction,
        referenceId,
        "Reloadly utility payment status checked",
      );
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        "Reloadly utility requery failed with unknown provider result",
      );
      throw new Error("Reloadly utility provider result unknown");
    }
  }

  async getHealth(): Promise<VtuProviderHealth> {
    const warnings: string[] = [];
    const configured = this.hasCredentials();

    if (!this.enabled) {
      warnings.push("Reloadly is not enabled for international VTU.");
    }

    if (!configured) {
      warnings.push("Missing Reloadly client credentials.");
    }

    if (!this.enabled || !configured) {
      return {
        id: "reloadly",
        name: "Reloadly",
        configured,
        enabled: this.enabled,
        supportsBalance: true,
        balance: { status: "unknown" },
        warnings,
      };
    }

    try {
      const token = await this.getTopupsAccessToken();
      const response = await firstValueFrom(
        this.httpService.get<ReloadlyBalanceResponse>(
          `${this.baseUrl}/accounts/balance`,
          { headers: this.authHeaders(token) },
        ),
      );
      const balance = this.parseNumericAmount(
        response.data.balance ?? response.data.amount,
      );
      const currency =
        response.data.currencyCode || response.data.currency || "USD";

      if (balance === null) {
        warnings.push(
          "Reloadly balance response did not include a valid amount.",
        );
        return {
          id: "reloadly",
          name: "Reloadly",
          configured,
          enabled: this.enabled,
          supportsBalance: true,
          balance: { status: "error", currency, checkedAt: new Date() },
          warnings,
        };
      }

      const threshold = this.getConfiguredThreshold(
        "RELOADLY_LOW_BALANCE_THRESHOLD",
        10,
      );
      if (balance < threshold) {
        warnings.push(
          `Reloadly balance is below configured threshold of ${currency} ${threshold}.`,
        );
      }

      return {
        id: "reloadly",
        name: "Reloadly",
        configured,
        enabled: this.enabled,
        supportsBalance: true,
        balance: {
          status: "available",
          amount: balance.toString(),
          currency,
          checkedAt: new Date(),
        },
        warnings,
      };
    } catch (error) {
      this.logger.warn(
        this.safeProviderError(error),
        "Unable to retrieve Reloadly wallet balance",
      );
      warnings.push("Unable to retrieve Reloadly wallet balance.");

      return {
        id: "reloadly",
        name: "Reloadly",
        configured,
        enabled: this.enabled,
        supportsBalance: true,
        balance: { status: "error", checkedAt: new Date() },
        warnings,
      };
    }
  }

  private async getTopupsAccessToken() {
    return this.getAccessToken("reloadly:topups:access_token", this.audience);
  }

  private async getUtilitiesAccessToken() {
    return this.getAccessToken(
      "reloadly:utilities:access_token",
      this.utilitiesAudience,
    );
  }

  private async getAccessToken(cacheKey: string, audience: string) {
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await firstValueFrom(
      this.httpService.post<ReloadlyTokenResponse>(
        this.authUrl,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
          audience,
        },
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    if (!response.data.access_token) {
      throw new BadRequestException("Reloadly authentication failed");
    }

    const ttl = Math.max((response.data.expires_in || 3600) - 60, 60);
    await this.redis.set(cacheKey, response.data.access_token, ttl);

    return response.data.access_token;
  }

  private authHeaders(token: string) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  private utilityAuthHeaders(token: string) {
    return {
      ...this.authHeaders(token),
      Accept: "application/com.reloadly.utilities-v1+json",
    };
  }

  private hasCredentials() {
    return Boolean(this.clientId && this.clientSecret);
  }

  assertReadyForPurchase() {
    if (this.canSimulate()) {
      return;
    }

    if (!this.enabled) {
      throw new BadRequestException("Reloadly provider is not enabled");
    }

    if (!this.hasCredentials()) {
      throw new BadRequestException("Reloadly credentials are not configured");
    }
  }

  private isProduction() {
    return this.configService.get<string>("NODE_ENV") === "production";
  }

  private canSimulate() {
    return !this.isProduction() && !this.enabled;
  }

  private shouldUseSimulation() {
    return this.canSimulate() || !this.hasCredentials();
  }

  private isLiveDisabled() {
    return this.isProduction() && !this.enabled;
  }

  private normalizeStatus(status?: string) {
    const normalized = status?.toLowerCase();

    if (
      normalized &&
      ["success", "successful", "completed"].includes(normalized)
    ) {
      return "success";
    }

    if (
      normalized &&
      ["failed", "rejected", "refunded", "reversed"].includes(normalized)
    ) {
      return "failed";
    }

    return "pending";
  }

  private getFallbackOperators(
    countryCode?: string,
    serviceType: "airtime" | "data" = "airtime",
  ): VtuProvider[] {
    const country = countryCode || "INT";
    return [
      {
        id: "342",
        name:
          country === "GH"
            ? "Ghana Mobile Operators"
            : country === "NG"
              ? "Airtel Nigeria"
              : "Reloadly Test Operator",
        type: serviceType,
        isActive: true,
      },
    ];
  }

  private getFallbackUtilityBillers(
    countryCode?: string,
    serviceType: "electricity" = "electricity",
  ): VtuProvider[] {
    const country = countryCode || "GH";
    return [
      {
        id: "26",
        name:
          country === "GH"
            ? "Ghana Electricity Test Biller"
            : "Reloadly Utility Test Biller",
        type: serviceType,
        isActive: true,
      },
    ];
  }

  private toDetectedOperator(
    operator: ReloadlyOperator,
    params: { countryCode: string; type: "airtime" | "data" },
  ): ReloadlyDetectedOperator {
    return {
      id: String(operator.operatorId),
      name: operator.name,
      type: params.type,
      isActive: true,
      countryCode: params.countryCode,
    };
  }

  private parseNumericAmount(value: unknown): number | null {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(parsed) ? parsed : null;
  }

  private extractList<T>(value: unknown): T[] {
    if (Array.isArray(value)) {
      return value as T[];
    }

    if (
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { content?: unknown }).content)
    ) {
      return (value as { content: T[] }).content;
    }

    return [];
  }

  private toUtilityProvider(
    biller: ReloadlyBiller,
    serviceType: "electricity",
  ): VtuProvider | null {
    const id = biller.id ?? biller.billerId;
    const name = biller.name ?? biller.billerName;

    if (!id || !name) {
      return null;
    }

    return {
      id: String(id),
      name,
      type: serviceType,
      isActive: true,
    };
  }

  private toUtilityResult(
    transaction: ReloadlyUtilityTransactionResponse,
    requestReference: string,
    fallbackMessage: string,
  ): ReloadlyProviderResult {
    return {
      reference:
        transaction.transactionId?.toString() ||
        transaction.id?.toString() ||
        transaction.billDetails?.billerReferenceId ||
        transaction.referenceId ||
        requestReference,
      status: this.normalizeStatus(transaction.status),
      message: transaction.message || fallbackMessage,
      providerRequestId: transaction.referenceId || requestReference,
      rawResponse: transaction as unknown as Record<string, unknown>,
    };
  }

  private utilityBillerType(serviceType: "electricity") {
    const mapping = {
      electricity: "ELECTRICITY_BILL_PAYMENT",
    } satisfies Record<typeof serviceType, string>;

    return mapping[serviceType];
  }

  private getConfiguredThreshold(key: string, fallback: number) {
    const configured = Number(this.configService.get<string>(key));
    return Number.isFinite(configured) && configured >= 0
      ? configured
      : fallback;
  }

  private safeProviderError(error: unknown) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      response?: { status?: unknown };
    };

    return {
      code: typeof candidate?.code === "string" ? candidate.code : undefined,
      status:
        typeof candidate?.response?.status === "number"
          ? candidate.response.status
          : undefined,
      message:
        typeof candidate?.message === "string"
          ? candidate.message
          : "Unknown provider error",
    };
  }
}
