"use client";

import { useQuery } from "@tanstack/react-query";
import { kycApi } from "@/services/api";
import {
  getMoneyActionGate,
  type GateUser,
  type MoneyActionGate,
  type MoneyActionOptions,
} from "./account-status";

/** Explanatory client gate; mutations always recheck authoritative server limits. */
export function useMoneyActionGate(
  user: GateUser,
  options: Omit<MoneyActionOptions, "overview"> = {},
): MoneyActionGate | null {
  const { data } = useQuery({
    queryKey: ["kyc-status", user?.id],
    queryFn: async () => (await kycApi.getStatus()).data,
    enabled: !!user,
    staleTime: 15_000,
  });
  return getMoneyActionGate(user, { ...options, overview: data });
}
