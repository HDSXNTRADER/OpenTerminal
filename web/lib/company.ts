import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

export type CompanyProfile = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  employees: number | null;
  description: string | null;
  officers: Array<{ name: string; title: string | null }>;
  exchange: string | null;
  currency: string | null;
  marketCap: number | null;
  analysts: {
    recommendation: string | null;
    mean: number | null;
    count: number | null;
    targetMean: number | null;
    targetHigh: number | null;
    targetLow: number | null;
    targetMedian: number | null;
    price: number | null;
    trend: Array<{ period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>;
    changes: Array<{ date: number; firm: string; from: string | null; to: string | null; action: string | null }>;
  };
  source: string;
};

/** Company profile + analyst consensus; shared by the DES and ANR widgets (one request per symbol). */
export function useCompany(symbol: string) {
  return useQuery({
    queryKey: ["company", symbol],
    queryFn: () => apiGet<CompanyProfile>(`/api/company/${encodeURIComponent(symbol)}`),
    staleTime: 3_600_000,
    retry: 1,
  });
}
