"use client";

import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiGet, fmt, type Candle } from "../../lib/api";
import { t } from "../../lib/i18n";
import { detectSignals } from "../../lib/signals";
import { usePickSymbol, useTerminal } from "../../store/terminal";

const MAX_SYMBOLS = 40;

/** Scans the active watchlist for classic daily-chart events (MA200, crosses, 52-week range, RSI, volume). */
export default function ScannerWidget() {
  const watchlist = useTerminal((s) => s.watchlist);
  const setActiveSymbol = usePickSymbol();
  const [onlyHits, setOnlyHits] = useState(true);
  const symbols = watchlist.slice(0, MAX_SYMBOLS);

  const results = useQueries({
    queries: symbols.map((s) => ({
      queryKey: ["history", s, "2Y", "1D"],
      // Two years so the 200-day average exists over the whole last year.
      queryFn: () => apiGet<Candle[]>(`/api/history/${encodeURIComponent(s)}?range=2Y&interval=1D`),
      staleTime: 300_000,
      refetchInterval: 300_000,
    })),
  });
  const key = results.map((r) => r.dataUpdatedAt).join(",");

  const rows = useMemo(
    () =>
      symbols.map((s, i) => {
        const c = results[i]?.data;
        return { symbol: s, last: c?.[c.length - 1]?.close ?? null, signals: c ? detectSignals(c) : null, error: results[i]?.error };
      }),
    [symbols.join(","), key] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shown = onlyHits ? rows.filter((r) => r.signals && r.signals.length > 0) : rows;
  const loading = results.filter((r) => r.isLoading).length;

  return (
    <div>
      <div className="flex gap-2 p-1 items-center text-[11px]">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={onlyHits} onChange={(e) => setOnlyHits(e.target.checked)} />
          {t("Only assets with signals")}
        </label>
        <span className="dim ml-auto">
          {loading ? t("Scanning {n} assets…", { n: loading }) : t("{n} assets from the active list, daily chart", { n: symbols.length })}
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Sym")}</th>
            <th>{t("Last")}</th>
            <th className="!text-left">{t("Signals")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.symbol} onClick={() => setActiveSymbol(r.symbol)}>
              <td className="font-bold">{r.symbol}</td>
              <td>{fmt(r.last)}</td>
              <td className="!text-left">
                {r.signals === null ? (
                  <span className="dim">{r.error ? "—" : "…"}</span>
                ) : r.signals.length === 0 ? (
                  <span className="dim">{t("nothing new")}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {r.signals.map((s) => (
                      <span key={s.kind} className={`border px-1 ${s.bullish ? "up border-[var(--up)]" : "down border-[var(--down)]"}`}>
                        {s.bullish ? "▲" : "▼"} {t(s.label)}
                      </span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && shown.length === 0 && <div className="p-3 dim">{t("No signals in the last few sessions.")}</div>}
    </div>
  );
}
