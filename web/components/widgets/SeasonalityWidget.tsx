"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiGet, fmt, type Candle } from "../../lib/api";
import { locale, t } from "../../lib/i18n";
import { monthlyReturns } from "../../lib/stats";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

/** Background tint for a % return: green up, red down, stronger for bigger moves. */
function tint(v: number | undefined): string | undefined {
  if (v === undefined) return undefined;
  const k = Math.min(1, Math.abs(v) / 10);
  return `color-mix(in srgb, var(${v >= 0 ? "--up" : "--down"}) ${Math.round(10 + k * 45)}%, transparent)`;
}

/** How the symbol usually behaves in each calendar month, from its full monthly history. */
export default function SeasonalityWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { data: candles, error, isLoading } = useQuery({
    queryKey: ["history", symbol, "MAX", "1M"],
    queryFn: () => apiGet<Candle[]>(`/api/history/${encodeURIComponent(symbol)}?range=MAX&interval=1M`),
    staleTime: 3_600_000,
  });

  const { years, grid, avg, positive } = useMemo(() => {
    const rets = monthlyReturns(candles ?? []);
    const grid = new Map<number, Map<number, number>>();
    for (const r of rets) {
      if (!grid.has(r.year)) grid.set(r.year, new Map());
      grid.get(r.year)!.set(r.month, r.ret);
    }
    const years = [...grid.keys()].sort((a, b) => b - a).slice(0, 15);
    const avg: Array<number | undefined> = [];
    const positive: Array<number | undefined> = [];
    for (let m = 0; m < 12; m++) {
      const vals = rets.filter((r) => r.month === m).map((r) => r.ret);
      avg.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined);
      positive.push(vals.length ? (vals.filter((v) => v > 0).length / vals.length) * 100 : undefined);
    }
    return { years, grid, avg, positive };
  }, [candles]);

  if (error) return <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>;
  if (isLoading) return <div className="p-2 dim">{t("Loading {s}…", { s: symbol })}</div>;

  const months = Array.from({ length: 12 }, (_, m) =>
    new Date(Date.UTC(2020, m, 15)).toLocaleString(locale(), { month: "short", timeZone: "UTC" }).replace(".", "")
  );
  const yearsCovered = new Set(monthlyReturns(candles ?? []).map((r) => r.year)).size;

  return (
    <div>
      <div className="px-2 py-1 dim text-[10px]">
        {t("Average monthly return over {n} years; the % row shows how often the month closed up.", { n: yearsCovered })}
      </div>
      <table className="data-table text-[10px]">
        <thead>
          <tr>
            <th></th>
            {months.map((m) => (
              <th key={m}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="font-bold">
            <td className="!text-left amber">{t("Avg")}</td>
            {avg.map((v, m) => (
              <td key={m} style={{ background: tint(v) }}>
                {v === undefined ? "—" : fmt(v, 1)}
              </td>
            ))}
          </tr>
          <tr>
            <td className="!text-left dim">% ↑</td>
            {positive.map((v, m) => (
              <td key={m} className="dim">
                {v === undefined ? "—" : fmt(v, 0)}
              </td>
            ))}
          </tr>
          {years.map((y) => (
            <tr key={y}>
              <td className="!text-left dim">{y}</td>
              {Array.from({ length: 12 }, (_, m) => {
                const v = grid.get(y)?.get(m);
                return (
                  <td key={m} style={{ background: tint(v) }}>
                    {v === undefined ? "" : fmt(v, 1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
