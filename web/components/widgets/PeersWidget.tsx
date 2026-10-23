"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass } from "../../lib/api";
import { t } from "../../lib/i18n";
import { usePickSymbol, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type Peer = {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
};
type Peers = { symbol: string; sector: string; market: "us" | "eu"; rows: Peer[] };

/** Distance from the 52-week high, in % (0 = at the high). */
const offHigh = (r: Peer) => (r.price && r.week52High ? ((r.price - r.week52High) / r.week52High) * 100 : null);

const COLS: Array<[string, (r: Peer) => number | null, (r: Peer) => string]> = [
  ["Last", (r) => r.price, (r) => fmt(r.price)],
  ["Chg%", (r) => r.changePercent, (r) => `${fmt(r.changePercent)}%`],
  ["Mkt Cap", (r) => r.marketCap, (r) => fmtBig(r.marketCap)],
  ["P/E", (r) => r.pe, (r) => fmt(r.pe, 1)],
  ["EPS", (r) => r.eps, (r) => fmt(r.eps)],
  ["Div. yield", (r) => r.dividendYield, (r) => (r.dividendYield == null ? "—" : `${fmt(r.dividendYield)}%`)],
  ["Beta", (r) => r.beta, (r) => fmt(r.beta)],
  ["From 52w high", offHigh, (r) => (offHigh(r) == null ? "—" : `${fmt(offHigh(r), 1)}%`)],
];

/** Relative value (Bloomberg RV): the company next to the closest-sized companies of its sector. */
export default function PeersWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const pick = usePickSymbol();
  const [sort, setSort] = useState<number | null>(2);
  const { data, isLoading, error } = useQuery({
    queryKey: ["peers", symbol],
    queryFn: () => apiGet<Peers>(`/api/peers/${encodeURIComponent(symbol)}`),
    refetchInterval: 30_000,
    retry: false,
  });

  if (error) return <div className="p-2 down">{t((error as Error).message)}</div>;
  if (isLoading || !data) return <div className="p-2 dim">{t("Loading…")}</div>;

  const rows = sort === null ? data.rows : [...data.rows].sort((a, b) => (COLS[sort][1](b) ?? -Infinity) - (COLS[sort][1](a) ?? -Infinity));
  // Sector median for each column, to see at a glance who is cheap or expensive.
  const median = COLS.map(([, get]) => {
    const v = data.rows.map(get).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  });

  return (
    <div>
      <div className="dim text-[10px] px-2 py-1">
        {t("Sector")}: <span className="amber">{t(data.sector)}</span> · {t("closest companies by market value")}
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Company")}</th>
            {COLS.map(([label], i) => (
              <th key={label} onClick={() => setSort(i)} className={sort === i ? "amber" : ""}>
                {t(label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} onClick={() => pick(r.symbol)} className={r.symbol === data.symbol ? "bg-[var(--select)]" : ""}>
              <td title={r.name}>
                <span className={r.symbol === data.symbol ? "amber font-bold" : "font-bold"}>{r.symbol}</span>{" "}
                <span className="dim">{r.name.slice(0, 22)}</span>
              </td>
              {COLS.map(([label, , show]) => (
                <td key={label} className={label === "Chg%" ? pctClass(r.changePercent) : ""}>
                  {show(r)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="dim">
            <td>{t("Median")}</td>
            {median.map((m, i) => (
              <td key={i}>{m === null ? "—" : i === 2 ? fmtBig(m) : fmt(m, i === 3 || i === 7 ? 1 : 2)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
