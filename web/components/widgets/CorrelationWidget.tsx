"use client";

import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiGet, fmt, type Candle } from "../../lib/api";
import { t } from "../../lib/i18n";
import { pearson, returnsByDay } from "../../lib/stats";
import { useTerminal } from "../../store/terminal";

const PERIODS = ["3M", "6M", "1Y"] as const;
const MAX_SYMBOLS = 12;

function tint(r: number | null): string | undefined {
  if (r === null) return undefined;
  return `color-mix(in srgb, var(${r >= 0 ? "--up" : "--down"}) ${Math.round(Math.abs(r) * 60)}%, transparent)`;
}

/** Correlation of daily returns between the symbols of the active watchlist. */
export default function CorrelationWidget() {
  const watchlist = useTerminal((s) => s.watchlist);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("6M");
  const symbols = watchlist.slice(0, MAX_SYMBOLS);

  const results = useQueries({
    queries: symbols.map((s) => ({
      queryKey: ["history", s, period, "1D"],
      queryFn: () => apiGet<Candle[]>(`/api/history/${encodeURIComponent(s)}?range=${period}&interval=1D`),
      staleTime: 600_000,
    })),
  });
  const key = results.map((r) => r.dataUpdatedAt).join(",");

  const matrix = useMemo(() => {
    const rets = results.map((r) => (r.data ? returnsByDay(r.data) : null));
    return symbols.map((_, i) =>
      symbols.map((_, j) => {
        const a = rets[i];
        const b = rets[j];
        if (!a || !b) return null;
        // Only days both assets traded.
        const xs: number[] = [];
        const ys: number[] = [];
        for (const [d, v] of a) {
          const w = b.get(d);
          if (w !== undefined) {
            xs.push(v);
            ys.push(w);
          }
        }
        return pearson(xs, ys);
      })
    );
  }, [symbols.join(","), key]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = results.some((r) => r.isLoading);

  return (
    <div>
      <div className="flex gap-1 p-1 items-center">
        {PERIODS.map((p) => (
          <button key={p} className={`term-btn ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>
            {p}
          </button>
        ))}
        <span className="dim text-[10px] ml-2">
          {loading ? t("Loading {s}…", { s: "" }) : t("+1 = move together · 0 = unrelated · −1 = opposite")}
        </span>
      </div>
      {symbols.length < 2 ? (
        <div className="p-3 dim">{t("Add at least two assets to the active watchlist.")}</div>
      ) : (
        <table className="data-table text-[10px]">
          <thead>
            <tr>
              <th></th>
              {symbols.map((s) => (
                <th key={s}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((s, i) => (
              <tr key={s}>
                <td className="!text-left font-bold cursor-pointer" onClick={() => setActiveSymbol(s)}>
                  {s}
                </td>
                {symbols.map((_, j) => (
                  <td key={j} style={{ background: i === j ? undefined : tint(matrix[i][j]) }} className={i === j ? "dim" : ""}>
                    {i === j ? "—" : matrix[i][j] === null ? "" : fmt(matrix[i][j], 2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
