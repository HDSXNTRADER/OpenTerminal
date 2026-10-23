"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { t } from "../../lib/i18n";
import { symbolsParam } from "../../lib/symbol";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";

type Rate = { date: string; value: number } | null;
type Rates = { selic: Rate; cdi: Rate; ipca12m: Rate };

const INDEXES: Array<[string, string]> = [
  ["^BVSP", "Ibovespa"],
  ["BOVA11.SA", "BOVA11"],
  ["SMAL11.SA", "SMAL11"],
  ["BRL=X", "Dólar (USD/BRL)"],
  ["EURBRL=X", "Euro (EUR/BRL)"],
];

const STOCKS = [
  "PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBDC4.SA", "BBAS3.SA", "ABEV3.SA",
  "WEGE3.SA", "B3SA3.SA", "PRIO3.SA", "RENT3.SA", "SUZB3.SA", "ELET3.SA",
];

/** Brazil at a glance: Ibovespa, dollar, policy rates (BCB) and the main B3 stocks. */
export default function BrazilWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const all = [...INDEXES.map(([s]) => s), ...STOCKS];
  const { data: quotes = [], error } = useQuery({
    queryKey: ["brazil-quotes"],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(all)}`),
    refetchInterval: 10_000,
  });
  const { data: rates } = useQuery({
    queryKey: ["brazil-rates"],
    queryFn: () => apiGet<Rates>("/api/brazil/rates"),
    staleTime: 3_600_000,
    retry: 1,
  });
  const q = (s: string) => quotes.find((x) => x.symbol === s);

  const row = (sym: string, label: string) => {
    const x = q(sym);
    return (
      <tr key={sym} onClick={() => setActiveSymbol(sym)}>
        <td className="!text-left font-bold">{label}</td>
        <td>
          <Flash value={x?.price}>{fmt(x?.price)}</Flash>
        </td>
        <td className={pctClass(x?.changePercent)}>
          <Flash value={x?.changePercent}>{fmt(x?.changePercent)}%</Flash>
        </td>
        <td className="dim">{fmtBig(x?.volume)}</td>
      </tr>
    );
  };

  return (
    <div>
      <div className="flex gap-4 px-2 py-1 text-[11px] border-b border-[var(--line)]">
        <span className="dim">
          Selic <span className="amber">{rates?.selic ? `${fmt(rates.selic.value, 2)}%` : "—"}</span>
        </span>
        <span className="dim">
          CDI <span className="amber">{rates?.cdi ? `${fmt(rates.cdi.value, 2)}%` : "—"}</span>
        </span>
        <span className="dim">
          IPCA 12m <span className="amber">{rates?.ipca12m ? `${fmt(rates.ipca12m.value, 2)}%` : "—"}</span>
        </span>
      </div>
      {error && <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Asset")}</th>
            <th>{t("Last")}</th>
            <th>{t("Chg%")}</th>
            <th>{t("Vol")}</th>
          </tr>
        </thead>
        <tbody>
          {INDEXES.map(([s, label]) => row(s, label))}
          <tr>
            <td colSpan={4} className="!text-left dim text-[10px] uppercase pt-2">
              {t("Main B3 stocks")}
            </td>
          </tr>
          {STOCKS.map((s) => row(s, s.replace(".SA", "")))}
        </tbody>
      </table>
    </div>
  );
}
