"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, pctClass } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { t } from "../../lib/i18n";

// Served by the optional OpenBB service (see README > OpenBB integration).
// Percent fields already arrive as whole percents (25 = 25%).
type Fundamentals = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  employees: number | null;
  currency: string | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  valuation: Record<"pe" | "forwardPe" | "peg" | "priceToBook" | "evToEbitda" | "evToRevenue", number | null>;
  profitability: Record<"grossMargin" | "operatingMargin" | "profitMargin" | "returnOnEquity" | "returnOnAssets", number | null>;
  growth: Record<"revenueGrowth" | "earningsGrowth" | "earningsGrowthQuarterly", number | null>;
  health: Record<"currentRatio" | "quickRatio" | "debtToEquity", number | null>;
  perShare: Record<"epsTtm" | "epsForward" | "bookValue" | "revenuePerShare" | "cashPerShare", number | null>;
  dividends: Record<"dividendYield" | "payoutRatio", number | null>;
  risk: Record<"beta" | "priceReturn1y", number | null>;
  source: string;
};

const pct = (n: number | null) => (n === null ? "—" : fmt(n, 1) + "%");

export default function FundamentalsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { data, isLoading, error } = useQuery({
    queryKey: ["fundamentals", symbol],
    queryFn: () => apiGet<Fundamentals>(`/api/fundamentals/${encodeURIComponent(symbol)}`),
    staleTime: 3_600_000,
    retry: false,
  });

  if (error) return <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>;
  if (isLoading || !data) return <div className="p-2 dim">{t("Loading fundamentals for {s}…", { s: symbol })}</div>;

  const sections: Array<[string, Array<[string, string, string?]>]> = [
    [
      t("Valuation"),
      [
        [t("Mkt Cap"), fmtBig(data.marketCap)],
        ["Ent. Value", fmtBig(data.enterpriseValue)],
        ["P/E (ttm)", fmt(data.valuation.pe)],
        ["Fwd P/E", fmt(data.valuation.forwardPe)],
        ["PEG", fmt(data.valuation.peg)],
        ["P/B", fmt(data.valuation.priceToBook)],
        ["EV/EBITDA", fmt(data.valuation.evToEbitda)],
        ["EV/Revenue", fmt(data.valuation.evToRevenue)],
      ],
    ],
    [
      t("Profitability"),
      [
        [t("Gross Margin"), pct(data.profitability.grossMargin)],
        [t("Oper. Margin"), pct(data.profitability.operatingMargin)],
        [t("Net Margin"), pct(data.profitability.profitMargin)],
        ["ROE", pct(data.profitability.returnOnEquity)],
        ["ROA", pct(data.profitability.returnOnAssets)],
      ],
    ],
    [
      t("Growth"),
      [
        [t("Revenue YoY"), pct(data.growth.revenueGrowth), pctClass(data.growth.revenueGrowth)],
        [t("Earnings YoY"), pct(data.growth.earningsGrowth), pctClass(data.growth.earningsGrowth)],
        [t("Earnings QoQ"), pct(data.growth.earningsGrowthQuarterly), pctClass(data.growth.earningsGrowthQuarterly)],
        ["1Y Return", pct(data.risk.priceReturn1y), pctClass(data.risk.priceReturn1y)],
      ],
    ],
    [
      t("Health / Per Share"),
      [
        [t("Current Ratio"), fmt(data.health.currentRatio)],
        [t("Quick Ratio"), fmt(data.health.quickRatio)],
        [t("Debt/Equity"), fmt(data.health.debtToEquity)],
        ["Beta", fmt(data.risk.beta)],
        ["EPS (ttm)", fmt(data.perShare.epsTtm)],
        ["EPS (fwd)", fmt(data.perShare.epsForward)],
        [t("Book/Share"), fmt(data.perShare.bookValue)],
        [t("Cash/Share"), fmt(data.perShare.cashPerShare)],
        [t("Div Yield"), pct(data.dividends.dividendYield)],
        [t("Payout"), pct(data.dividends.payoutRatio)],
      ],
    ],
  ];

  return (
    <div className="p-2">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-bold">{data.name ?? data.symbol}</span>
        <span className="dim text-[10px] ml-auto">{data.source}</span>
      </div>
      {(data.sector || data.industry || data.employees) && (
        <div className="dim text-[11px] mb-2 truncate">
          {[data.sector, data.industry, data.employees ? `${fmtBig(data.employees)} employees` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {sections.map(([title, rows]) => (
        <div key={title} className="mb-2">
          <div className="text-[var(--amber)] text-[10px] uppercase tracking-wider mb-0.5">{title}</div>
          <div className="grid grid-cols-2 gap-x-4">
            {rows.map(([label, value, cls]) => (
              <div key={label} className="flex justify-between border-b border-[var(--line)] py-0.5">
                <span className="dim">{label}</span>
                <span className={cls}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {data.description && <p className="dim text-[11px] leading-snug line-clamp-4">{data.description}</p>}
    </div>
  );
}
