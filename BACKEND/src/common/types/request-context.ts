import type { Request } from 'express';

export type AuthenticatedUser = {
  userId: string;
  role?: string;
};

export type AuthenticatedRequest = Request & {
  id?: string | number | null;
  user?: AuthenticatedUser;
};

export type RawBodyRequest = AuthenticatedRequest & {
  rawBody?: string;
};
