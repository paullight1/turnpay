export interface User {
  id: string;
  email: string;
  phone: string;
  role: string;
  kycStatus: string;
}

export interface Wallet {
  id: string;
  currency: string;
  balance: number | string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number | string;
  currency: string;
  status: string;
  reference: string;
  fee: number | string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeQuote {
  id: string;
  from: string;
  to: string;
  amount: number;
  rate: number;
  markupPercent: number;
  fee: number;
  sendAmount: number;
  receiveAmount: number;
  expiresAt: string;
  createdAt: string;
}

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

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}
