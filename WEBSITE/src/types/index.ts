export interface User {
  id: string;
  email: string;
  phone: string;
  role: string;
  kycStatus: string;
  isSuspended?: boolean;
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

export interface SupportTicket {
  id: string;
  userId: string;
  transactionId?: string | null;
  type: string;
  description: string;
  status: string;
  resolution?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id?: string;
    email?: string;
    phone?: string;
    kycStatus?: string;
    isSuspended?: boolean;
  };
  transaction?: {
    id: string;
    reference: string;
    type: string;
    amount: number | string;
    currency: string;
    status: string;
    createdAt: string;
  } | null;
}
