"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type Statements = {
  symbol: string;
  freq: "annual" | "quarterly";
  periods: string[];
  rows: Record<string, Array<number | null>>;
  currency: string | null;
  source: string;
};

const SECTIONS: Record<string, Array<[string, string]>> = {
  income: [
    ["TotalRevenue", "Revenue"],
    ["GrossProfit", "Gross profit"],
    ["OperatingIncome", "Operating income"],
    ["EBITDA", "EBITDA"],
    ["NetIncome", "Net income"],
    ["DilutedEPS", "EPS (diluted)"],
  ],
  balance: [
    ["TotalAssets", "Total assets"],
    ["TotalLiabilitiesNetMinorityInterest", "Total liabilities"],
    ["StockholdersEquity", "Shareholders' equity"],
    ["CashAndCashEquivalents", "Cash"],
    ["TotalDebt", "Total debt"],
  ],
  cashflow: [
    ["OperatingCashFlow", "Operating cash flow"],
    ["CapitalExpenditure", "Capex"],
    ["FreeCashFlow", "Free cash flow"],
  ],
};
const TABS: Array<[string, string]> = [
  ["income", "Income"],
  ["balance", "Balance sheet"],
  ["cashflow", "Cash flow"],
];

/** Financial statements (Bloomberg FA): income, balance sheet and cash flow, last 5 years or 8 quarters. */
export default function FinancialsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const setWidgetSettings = useTerminal((s) => s.setWidgetSettings);
  const tab = (widget.settings?.tab as string) ?? "income";
  const freq = (widget.settings?.freq as string) ?? "annual";
  const { data, isLoading, error } = useQuery({
    queryKey: ["financials", symbol, freq],
    queryFn: () => apiGet<Statements>(`/api/financials/${encodeURIComponent(symbol)}?freq=${freq}`),
    staleTime: 6 * 3_600_000,
    retry: 1,
  });

  const label = (d: string) => (freq === "annual" ? d.slice(0, 4) : `${d.slice(5, 7)}/${d.slice(2, 4)}`);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 items-center shrink-0 flex-wrap">
        {TABS.map(([k, name]) => (
          <button key={k} className={`term-btn ${tab === k ? "active" : ""}`} onClick={() => setWidgetSettings(widget.id, { tab: k })}>
            {t(name)}
          </button>
        ))}
        <span className="ml-2" />
        {(["annual", "quarterly"] as const).map((f) => (
          <button key={f} className={`term-btn ${freq === f ? "active" : ""}`} onClick={() => setWidgetSettings(widget.id, { freq: f })}>
            {t(f === "annual" ? "Annual" : "Quarterly")}
          </button>
        ))}
        {data?.currency && <span className="dim text-[10px] ml-auto">{data.currency}</span>}
      </div>
      {error && <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>}
      {isLoading && <div className="p-2 dim">{t("Loading…")}</div>}
      {data && (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                {data.periods.map((p) => (
                  <th key={p}>{label(p)}</th>
                ))}
                <th title={t("Change vs the previous period")}>{t("Growth")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS[tab].map(([field, name]) => {
                const vals = data.rows[field] ?? [];
                const last = vals[vals.length - 1];
                const prev = vals[vals.length - 2];
                const growth = last != null && prev ? ((last - prev) / Math.abs(prev)) * 100 : null;
                const max = Math.max(...vals.map((v) => Math.abs(v ?? 0)), 1);
                return (
                  <tr key={field}>
                    <td className="font-bold">{t(name)}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={v != null && v < 0 ? "down" : ""}>
                        {field === "DilutedEPS" ? fmt(v) : fmtBig(v)}
                      </td>
                    ))}
                    <td className={growth === null ? "dim" : growth >= 0 ? "up" : "down"}>
                      {growth === null ? "—" : `${growth >= 0 ? "+" : ""}${fmt(growth, 1)}%`}
                    </td>
                    <td>
                      {/* Mini bar chart of the row, oldest to newest. */}
                      <div className="flex items-end gap-[2px] h-4 w-16">
                        {vals.map((v, i) => (
                          <div
                            key={i}
                            className="flex-1"
                            style={{
                              height: `${(Math.abs(v ?? 0) / max) * 100}%`,
                              background: v != null && v < 0 ? "var(--down)" : "var(--amber-dim)",
                            }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="dim text-[10px] px-2 py-1">{t("Source")}: {data.source}</div>
        </div>
      )}
    </div>
  );
}
