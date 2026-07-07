import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { firstValueFrom } from "rxjs";
import { VtuProviderHealth } from "./provider-health.types";

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

export interface VtuProviderResult {
  reference: string;
  status: string;
  message: string;
  providerRequestId?: string;
  rawResponse?: Record<string, unknown>;
}

type VtuServiceType = "airtime" | "data" | "cable" | "electricity";
type VtuProviderMode = "generic" | "vtpass";

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
    };
  };
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
  };
}

const VTPASS_SERVICES: VtpassServiceDefinition[] = [
  { id: "mtn", name: "MTN", type: "airtime", serviceID: "mtn", isActive: true },
  {
    id: "airtel",
    name: "Airtel",
    type: "airtime",
    serviceID: "airtel",
    isActive: true,
  },
  { id: "glo", name: "Glo", type: "airtime", serviceID: "glo", isActive: true },
  {
    id: "9mobile",
    name: "9mobile",
    type: "airtime",
    serviceID: "etisalat",
    isActive: true,
  },
  {
    id: "mtn",
    name: "MTN Data",
    type: "data",
    serviceID: "mtn-data",
    isActive: true,
  },
  {
    id: "airtel",
    name: "Airtel Data",
    type: "data",
    serviceID: "airtel-data",
    isActive: true,
  },
  {
    id: "glo",
    name: "Glo Data",
    type: "data",
    serviceID: "glo-data",
    isActive: true,
  },
  {
    id: "9mobile",
    name: "9mobile Data",
    type: "data",
    serviceID: "etisalat-data",
    isActive: true,
  },
  {
    id: "dstv",
    name: "DStv",
    type: "cable",
    serviceID: "dstv",
    isActive: true,
  },
  {
    id: "gotv",
    name: "GOtv",
    type: "cable",
    serviceID: "gotv",
    isActive: true,
  },
  {
    id: "startimes",
    name: "StarTimes",
    type: "cable",
    serviceID: "startimes",
    isActive: true,
  },
  {
    id: "ikedc",
    name: "Ikeja Electric",
    type: "electricity",
    serviceID: "ikeja-electric",
    isActive: true,
  },
  {
    id: "ekedc",
    name: "Eko Electric",
    type: "electricity",
    serviceID: "eko-electric",
    isActive: true,
  },
  {
    id: "aedc",
    name: "Abuja Electric",
    type: "electricity",
    serviceID: "abuja-electric",
    isActive: true,
  },
  {
    id: "ibedc",
    name: "Ibadan Electric",
    type: "electricity",
    serviceID: "ibadan-electric",
    isActive: true,
  },
  {
    id: "phed",
    name: "Port Harcourt Electric",
    type: "electricity",
    serviceID: "portharcourt-electric",
    isActive: true,
  },
  {
    id: "jed",
    name: "Jos Electric",
    type: "electricity",
    serviceID: "jos-electric",
    isActive: true,
  },
  {
    id: "kedco",
    name: "Kano Electric",
    type: "electricity",
    serviceID: "kano-electric",
    isActive: true,
  },
  {
    id: "kaedco",
    name: "Kaduna Electric",
    type: "electricity",
    serviceID: "kaduna-electric",
    isActive: true,
  },
  {
    id: "eedc",
    name: "Enugu Electric",
    type: "electricity",
    serviceID: "enugu-electric",
    isActive: true,
  },
  {
    id: "bedc",
    name: "Benin Electric",
    type: "electricity",
    serviceID: "benin-electric",
    isActive: true,
  },
  {
    id: "aba",
    name: "ABA Power",
    type: "electricity",
    serviceID: "aba-electric",
    isActive: true,
  },
  {
    id: "yedc",
    name: "Yola Electric",
    type: "electricity",
    serviceID: "yola-electric",
    isActive: true,
  },
];

@Injectable()
export class VtuApiProvider {
  private readonly providerMode: VtuProviderMode;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly publicKey: string;
  private readonly secretKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.providerMode =
      this.configService.get<string>("VTU_PROVIDER") === "vtpass"
        ? "vtpass"
        : "generic";
    this.baseUrl =
      this.configService.get<string>("VTPASS_BASE_URL") ||
      this.configService.get<string>("VTU_API_URL") ||
      "";
    this.apiKey =
      this.configService.get<string>("VTPASS_API_KEY") ||
      this.configService.get<string>("VTU_API_KEY") ||
      "";
    this.publicKey = this.configService.get<string>("VTPASS_PUBLIC_KEY") || "";
    this.secretKey = this.configService.get<string>("VTPASS_SECRET_KEY") || "";
    this.logger.setContext(VtuApiProvider.name);

    if (
      this.configService.get<string>("NODE_ENV") === "production" &&
      this.providerMode === "vtpass" &&
      (!this.baseUrl || !this.apiKey || !this.publicKey || !this.secretKey)
    ) {
      throw new Error("VTpass provider credentials are not configured");
    }

    if (
      this.configService.get<string>("NODE_ENV") === "production" &&
      this.providerMode === "generic" &&
      (!this.baseUrl || !this.apiKey)
    ) {
      throw new Error("VTU provider credentials are not configured");
    }
  }

  private get genericHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private get vtpassGetHeaders() {
    return {
      "Content-Type": "application/json",
      "api-key": this.apiKey,
      "public-key": this.publicKey,
    };
  }

  private get vtpassPostHeaders() {
    return {
      "Content-Type": "application/json",
      "api-key": this.apiKey,
      "secret-key": this.secretKey,
    };
  }

  async getProviders(type?: string): Promise<VtuProvider[]> {
    if (this.providerMode === "vtpass") {
      return this.getVtpassProviders(type);
    }

    if (!this.baseUrl) {
      return this.getFallbackProviders(type);
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ providers: VtuProvider[] }>(
          `${this.baseUrl}/providers`,
          { headers: this.genericHeaders, params: type ? { type } : undefined },
        ),
      );
      return response.data.providers;
    } catch {
      this.logger.warn("VTU API unavailable, using fallback providers");
      return this.getFallbackProviders(type);
    }
  }

  getProviderName() {
    return this.providerMode === "vtpass" ? "VTPASS" : "GENERIC";
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
    const enabled = this.providerMode === "vtpass";

    if (!enabled) {
      warnings.push("VTpass is not the active local VTU provider.");
    }

    for (const [name, isConfigured] of Object.entries(requiredCredentials)) {
      if (!isConfigured) {
        warnings.push(`Missing VTpass ${name} configuration.`);
      }
    }

    if (!enabled || !configured) {
      return {
        id: "vtpass",
        name: "VTpass",
        configured,
        enabled,
        supportsBalance: true,
        balance: { status: "unknown", currency: "NGN" },
        warnings,
      };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<VtpassBalanceResponse>(`${this.baseUrl}/balance`, {
          headers: this.vtpassGetHeaders,
        }),
      );
      const balance = this.parseNumericAmount(response.data.contents?.balance);

      if (balance === null) {
        warnings.push(
          "VTpass balance response did not include a valid amount.",
        );
        return {
          id: "vtpass",
          name: "VTpass",
          configured,
          enabled,
          supportsBalance: true,
          balance: { status: "error", currency: "NGN", checkedAt: new Date() },
          warnings,
        };
      }

      const threshold = this.getConfiguredThreshold(
        "VTPASS_LOW_BALANCE_THRESHOLD",
        5000,
      );
      if (balance < threshold) {
        warnings.push(
          `VTpass balance is below configured threshold of NGN ${threshold}.`,
        );
      }

      return {
        id: "vtpass",
        name: "VTpass",
        configured,
        enabled,
        supportsBalance: true,
        balance: {
          status: "available",
          amount: balance.toString(),
          currency: "NGN",
          checkedAt: new Date(),
        },
        warnings,
      };
    } catch (error) {
      this.logger.warn(
        this.safeProviderError(error),
        "Unable to retrieve VTpass wallet balance",
      );
      warnings.push("Unable to retrieve VTpass wallet balance.");

      return {
        id: "vtpass",
        name: "VTpass",
        configured,
        enabled,
        supportsBalance: true,
        balance: { status: "error", currency: "NGN", checkedAt: new Date() },
        warnings,
      };
    }
  }

  async getPackages(provider: string): Promise<VtuPackage[]> {
    if (this.providerMode === "vtpass") {
      return this.getVtpassPackages(provider);
    }

    if (!this.baseUrl) {
      return this.getFallbackPackages(provider);
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ packages: VtuPackage[] }>(
          `${this.baseUrl}/packages`,
          { headers: this.genericHeaders, params: { provider } },
        ),
      );
      return response.data.packages;
    } catch {
      this.logger.warn("VTU API unavailable, using fallback packages");
      return this.getFallbackPackages(provider);
    }
  }

  async purchase(params: {
    type: string;
    provider: string;
    recipientNumber?: string;
    amount: number;
    reference: string;
    packageId?: string;
    smartCardNumber?: string;
    meterNumber?: string;
    providerRequestId?: string;
  }): Promise<VtuProviderResult> {
    if (this.providerMode === "vtpass") {
      return this.purchaseViaVtpass(params);
    }

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
      reference: params.reference,
      provider_request_id: params.providerRequestId,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<{
          reference: string;
          status: string;
          message: string;
        }>(`${this.baseUrl}/purchase`, payload, {
          headers: this.genericHeaders,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        "VTU purchase request failed with unknown provider result",
      );
      throw new Error("VTU provider result unknown");
    }
  }

  async validateSmartCard(
    provider: string,
    smartCardNumber: string,
  ): Promise<{ name: string; status: string }> {
    if (!this.baseUrl) {
      return { name: "Test User", status: "active" };
    }

    if (this.providerMode === "vtpass") {
      const service = this.findVtpassService(provider, ["cable"]);
      if (!service) {
        throw new BadRequestException("Unsupported VTpass cable service");
      }

      const content = await this.vtpassMerchantVerify({
        serviceID: service.serviceID,
        billersCode: smartCardNumber,
      });

      return {
        name: content.Customer_Name || "Unknown customer",
        status: (content.Status || "active").toLowerCase(),
      };
    }

    const response = await firstValueFrom(
      this.httpService.get<{ name: string; status: string }>(
        `${this.baseUrl}/validate`,
        {
          headers: this.genericHeaders,
          params: { provider, number: smartCardNumber },
        },
      ),
    );

    return response.data;
  }

  async validateMeter(
    provider: string,
    meterNumber: string,
  ): Promise<{ name: string; address: string }> {
    if (!this.baseUrl) {
      return { name: "Test Customer", address: "Test Address" };
    }

    if (this.providerMode === "vtpass") {
      const service = this.findVtpassService(provider, ["electricity"]);
      if (!service) {
        throw new BadRequestException(
          "Unsupported VTpass electricity service",
        );
      }

      const content = await this.vtpassMerchantVerify({
        serviceID: service.serviceID,
        billersCode: meterNumber,
        // Purchase payloads are prepaid-only today; keep verification aligned.
        type: "prepaid",
      });

      return {
        name: content.Customer_Name || "Unknown customer",
        address: content.Address || "",
      };
    }

    const response = await firstValueFrom(
      this.httpService.get<{ name: string; address: string }>(
        `${this.baseUrl}/validate-meter`,
        {
          headers: this.genericHeaders,
          params: { provider, number: meterNumber },
        },
      ),
    );

    return response.data;
  }

  private async vtpassMerchantVerify(payload: {
    serviceID: string;
    billersCode: string;
    type?: string;
  }) {
    let response: VtpassMerchantVerifyResponse;
    try {
      const httpResponse = await firstValueFrom(
        this.httpService.post<VtpassMerchantVerifyResponse>(
          `${this.baseUrl}/merchant-verify`,
          payload,
          { headers: this.vtpassPostHeaders },
        ),
      );
      response = httpResponse.data;
    } catch (error) {
      this.logger.warn(
        this.safeProviderError(error),
        "VTpass merchant verification request failed",
      );
      throw new ServiceUnavailableException(
        "Customer verification is temporarily unavailable. Try again shortly.",
      );
    }

    const content = response.content;
    if (!content || content.error || `${response.code}` !== "000") {
      throw new BadRequestException(
        "We could not verify this customer number. Check it and try again.",
      );
    }

    return content;
  }

  private getFallbackProviders(type?: string): VtuProvider[] {
    const networkProviders: VtuProvider[] = [
      { id: "mtn", name: "MTN", type: "airtime", isActive: true },
      { id: "airtel", name: "Airtel", type: "airtime", isActive: true },
      { id: "glo", name: "Glo", type: "airtime", isActive: true },
      { id: "9mobile", name: "9mobile", type: "airtime", isActive: true },
    ];
    const dataProviders: VtuProvider[] = networkProviders.map((provider) => ({
      ...provider,
      type: "data",
    }));
    const billProviders: VtuProvider[] = [
      { id: "dstv", name: "DStv", type: "cable", isActive: true },
      { id: "gotv", name: "GOtv", type: "cable", isActive: true },
      { id: "startimes", name: "StarTimes", type: "cable", isActive: true },
      {
        id: "ikedc",
        name: "Ikeja Electric",
        type: "electricity",
        isActive: true,
      },
      {
        id: "ekedc",
        name: "Eko Electric",
        type: "electricity",
        isActive: true,
      },
      {
        id: "aedc",
        name: "Abuja Electric",
        type: "electricity",
        isActive: true,
      },
      {
        id: "ibedc",
        name: "Ibadan Electric",
        type: "electricity",
        isActive: true,
      },
      {
        id: "phed",
        name: "Port Harcourt Electric",
        type: "electricity",
        isActive: true,
      },
    ];
    const allProviders: VtuProvider[] = [
      ...networkProviders,
      ...dataProviders,
      ...billProviders,
    ];

    if (type) {
      return allProviders.filter((p) => p.type === type);
    }

    return allProviders;
  }

  private getFallbackPackages(provider: string): VtuPackage[] {
    const packages: Record<string, VtuPackage[]> = {
      mtn: [
        { id: "mtn-500mb", name: "500MB", price: 150, validity: "30 days" },
        { id: "mtn-1gb", name: "1GB", price: 300, validity: "30 days" },
        { id: "mtn-2gb", name: "2GB", price: 500, validity: "30 days" },
        { id: "mtn-5gb", name: "5GB", price: 1200, validity: "30 days" },
      ],
      airtel: [
        { id: "airtel-500mb", name: "500MB", price: 150, validity: "30 days" },
        { id: "airtel-1gb", name: "1GB", price: 300, validity: "30 days" },
        { id: "airtel-2gb", name: "2GB", price: 500, validity: "30 days" },
      ],
      glo: [
        { id: "glo-1gb", name: "1GB", price: 250, validity: "30 days" },
        { id: "glo-2gb", name: "2GB", price: 500, validity: "30 days" },
      ],
      "9mobile": [
        { id: "eti-500", name: "500MB", price: 500, validity: "30 days" },
        { id: "eti-1000", name: "1.5GB", price: 1000, validity: "30 days" },
      ],
      dstv: [
        { id: "dstv-jolli", name: "Jolli", price: 6500, validity: "30 days" },
        {
          id: "dstv-premium",
          name: "Premium",
          price: 29500,
          validity: "30 days",
        },
      ],
      gotv: [
        { id: "gotv-jinja", name: "Jinja", price: 3100, validity: "30 days" },
        { id: "gotv-max", name: "Max", price: 9300, validity: "30 days" },
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
      return this.getFallbackPackages(provider);
    }

    const service = this.findVtpassService(provider, ["data", "cable"]);
    if (!service) {
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<VtpassResponse>(
          `${this.baseUrl}/service-variations`,
          {
            headers: this.vtpassGetHeaders,
            params: { serviceID: service.serviceID },
          },
        ),
      );
      const variations =
        response.data.content?.variations || response.data.content?.varations;

      return (variations || [])
        .filter((variation) => variation.variation_code)
        .map((variation) => ({
          id: variation.variation_code as string,
          name: variation.name || variation.variation_code || "VTU package",
          price: Number(variation.variation_amount || 0),
          validity: this.extractValidity(variation.name),
        }))
        .filter((variation) => Number.isFinite(variation.price));
    } catch {
      this.logger.warn(
        "VTpass variations unavailable, using fallback packages",
      );
      return this.getFallbackPackages(provider);
    }
  }

  private async purchaseViaVtpass(params: {
    type: string;
    provider: string;
    recipientNumber?: string;
    amount: number;
    reference: string;
    packageId?: string;
    smartCardNumber?: string;
    meterNumber?: string;
    providerRequestId?: string;
  }): Promise<VtuProviderResult> {
    if (!this.baseUrl) {
      return this.simulatePurchase(params);
    }

    const service = this.findVtpassService(params.provider, [
      params.type as VtuServiceType,
    ]);
    if (!service) {
      throw new BadRequestException("Unsupported VTpass service");
    }

    const requestId =
      params.providerRequestId ||
      this.createProviderRequestId(params.reference);
    const payload = this.buildVtpassPurchasePayload(params, service, requestId);

    try {
      const response = await firstValueFrom(
        this.httpService.post<VtpassResponse>(`${this.baseUrl}/pay`, payload, {
          headers: this.vtpassPostHeaders,
        }),
      );
      return this.mapVtpassPurchaseResponse(response.data, requestId);
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        "VTpass purchase request failed with unknown provider result",
      );
      throw new Error("VTU provider result unknown");
    }
  }

  private buildVtpassPurchasePayload(
    params: {
      type: string;
      recipientNumber?: string;
      amount: number;
      packageId?: string;
      smartCardNumber?: string;
      meterNumber?: string;
    },
    service: VtpassServiceDefinition,
    requestId: string,
  ) {
    if (params.type === "airtime") {
      return {
        request_id: requestId,
        serviceID: service.serviceID,
        amount: params.amount,
        phone: params.recipientNumber,
      };
    }

    if (params.type === "data") {
      return {
        request_id: requestId,
        serviceID: service.serviceID,
        billersCode: params.recipientNumber,
        variation_code: params.packageId,
        amount: params.amount,
        phone: params.recipientNumber,
      };
    }

    if (params.type === "cable") {
      return {
        request_id: requestId,
        serviceID: service.serviceID,
        billersCode: params.smartCardNumber,
        variation_code: params.packageId,
        amount: params.amount,
        phone: params.recipientNumber,
        subscription_type: "change",
      };
    }

    return {
      request_id: requestId,
      serviceID: service.serviceID,
      billersCode: params.meterNumber,
      variation_code: "prepaid",
      amount: params.amount,
      phone: params.recipientNumber,
    };
  }

  private mapVtpassPurchaseResponse(data: VtpassResponse, requestId: string) {
    return {
      reference:
        data.content?.transactions?.transactionId ||
        data.requestId ||
        requestId,
      status: this.normalizeVtpassStatus(data),
      message:
        data.response_description ||
        data.content?.transactions?.status ||
        "VTpass transaction submitted",
      providerRequestId: requestId,
      rawResponse: data as unknown as Record<string, unknown>,
    };
  }

  async requery(providerRequestId: string): Promise<VtuProviderResult> {
    if (this.providerMode !== "vtpass" || !this.baseUrl) {
      return {
        reference: providerRequestId,
        status: "pending",
        message: "VTU requery simulated",
        providerRequestId,
      };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<VtpassResponse>(
          `${this.baseUrl}/requery`,
          { request_id: providerRequestId },
          { headers: this.vtpassPostHeaders },
        ),
      );
      return this.mapVtpassPurchaseResponse(response.data, providerRequestId);
    } catch (error) {
      this.logger.error(
        this.safeProviderError(error),
        "VTpass requery failed with unknown provider result",
      );
      throw new Error("VTU provider result unknown");
    }
  }

  private normalizeVtpassStatus(data: VtpassResponse) {
    const status = data.content?.transactions?.status?.toLowerCase();
    const code = data.code;
    const description = data.response_description?.toLowerCase() || "";

    if (
      status &&
      ["delivered", "successful", "success", "completed"].includes(status)
    ) {
      return "success";
    }

    if (
      status &&
      ["pending", "initiated", "processing", "queued"].includes(status)
    ) {
      return "pending";
    }

    if (
      status &&
      ["failed", "reversed", "refunded", "cancelled", "rejected"].includes(
        status,
      )
    ) {
      return "failed";
    }

    if (code === "099") {
      return "pending";
    }

    if (["016", "091", "010", "011", "012", "030"].includes(code || "")) {
      return "failed";
    }

    if (code === "000" && description.includes("successful")) {
      return "success";
    }

    return "pending";
  }

  private findVtpassService(provider: string, types: VtuServiceType[]) {
    return VTPASS_SERVICES.find(
      (service) => service.id === provider && types.includes(service.type),
    );
  }

  createProviderRequestId(reference: string, date = new Date()) {
    if (this.providerMode !== "vtpass") {
      return reference;
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .reduce<Record<string, string>>((acc, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});
    const prefix = `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
    const suffix = reference.replace(/[^A-Za-z0-9]/g, "").slice(-24);

    return `${prefix}${suffix}`;
  }

  private extractValidity(name?: string) {
    if (!name) {
      return "Provider defined";
    }

    const match = name.match(
      /(\d+\s*(?:hrs|hr|hours|hour|days|day|months|month))/i,
    );
    return match?.[1] || "Provider defined";
  }

  private simulatePurchase(params: {
    type: string;
    provider: string;
    recipientNumber?: string;
    amount: number;
    reference: string;
  }): { reference: string; status: string; message: string } {
    return {
      reference: params.reference,
      status: "success",
      message: `${params.type} purchase simulated successfully`,
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
