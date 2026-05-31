export type ProviderBalanceStatus = "available" | "unknown" | "error";

export interface ProviderBalanceHealth {
  status: ProviderBalanceStatus;
  amount?: string;
  currency?: string;
  checkedAt?: Date;
}

export interface VtuProviderHealth {
  id: "vtpass" | "reloadly";
  name: string;
  configured: boolean;
  enabled: boolean;
  supportsBalance: boolean;
  balance: ProviderBalanceHealth;
  warnings: string[];
}

export interface VtuProviderHealthResponse {
  generatedAt: Date;
  providers: VtuProviderHealth[];
}
