"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import Flash from "../Flash";
import { t } from "../../lib/i18n";

type ShortVolume = { date: string; shortVolume: number; shortExemptVolume: number; totalVolume: number; shortVolumePercent: number };

export default function QuoteWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { data, error } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbol)}`))[0],
    refetchInterval: 1_000,
  });
  // FINRA's Reg SHO file only updates once a day (next-morning), so no point polling it fast.
  const { data: shortVol } = useQuery({
    queryKey: ["short-volume", symbol],
    queryFn: () => apiGet<ShortVolume | null>(`/api/short-volume/${encodeURIComponent(symbol)}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>;
  if (!data) return <div className="p-2 dim">{t("Loading {s}…", { s: symbol })}</div>;

  const rows: Array<[string, string, string?]> = [
    [t("Open"), fmt(data.open)],
    [t("High"), fmt(data.high)],
    [t("Low"), fmt(data.low)],
    [t("Prev Close"), fmt(data.previousClose)],
    [t("Bid"), fmt(data.bid)],
    [t("Ask"), fmt(data.ask)],
    [t("Volume"), fmtBig(data.volume)],
    [t("Avg Vol 3M"), fmtBig(data.avgVolume)],
    ...(shortVol ? ([[t("Short Vol %"), fmt(shortVol.shortVolumePercent, 1) + "%"]] as Array<[string, string]>) : []),
    [t("Mkt Cap"), fmtBig(data.marketCap)],
    ["P/E (ttm)", fmt(data.pe)],
    ["EPS (ttm)", fmt(data.eps)],
    [t("Div Yield"), data.dividendYield !== null ? fmt(data.dividendYield * 100) + "%" : "—"],
    [t("52W High"), fmt(data.week52High)],
    [t("52W Low"), fmt(data.week52Low)],
    ["Beta", fmt(data.beta)],
    [t("Shares Out"), fmtBig(data.sharesOutstanding)],
  ];

  return (
    <div className="p-2">
      <div className="flex items-baseline gap-3 mb-1">
        <Flash value={data.price} className="text-xl font-bold">{fmt(data.price)}</Flash>
        <Flash value={data.changePercent} className={`${pctClass(data.changePercent)} text-sm`}>
          {data.change !== null && data.change >= 0 ? "+" : ""}
          {fmt(data.change)} ({fmt(data.changePercent)}%)
        </Flash>
        <span className="dim text-[10px] ml-auto">
          {data.exchange ?? ""} · {data.currency ?? ""} · {data.source}
        </span>
      </div>
      <div className="dim text-[11px] mb-2 truncate">{data.name}</div>
      <div className="grid grid-cols-2 gap-x-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between border-b border-[var(--line)] py-0.5">
            <span className="dim">{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
