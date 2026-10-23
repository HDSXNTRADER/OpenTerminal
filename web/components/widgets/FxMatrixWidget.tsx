"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, type Quote } from "../../lib/api";
import { t } from "../../lib/i18n";
import { symbolsParam } from "../../lib/symbol";
import { usePickSymbol } from "../../store/terminal";

const CCY = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "BRL"];

/** Digits that make each cross readable (JPY crosses are in the hundreds). */
const digits = (v: number) => (v >= 100 ? 2 : v >= 10 ? 3 : 4);

/**
 * Cross-currency matrix (Bloomberg FXC). Every rate comes from the USD pairs
 * ("BRL=X" = reais per dollar), so one request covers all 72 crosses.
 * Row = base currency, column = quote currency: 1 row = X column.
 */
export default function FxMatrixWidget() {
  const pick = usePickSymbol();
  const [mode, setMode] = useState<"price" | "change">("price");
  const pairs = CCY.filter((c) => c !== "USD").map((c) => `${c}=X`);
  const { data: quotes = [], error } = useQuery({
    queryKey: ["fx-matrix"],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(pairs)}`),
    refetchInterval: 10_000,
  });

  const perUsd = (c: string, prev = false): number | null => {
    if (c === "USD") return 1;
    const q = quotes.find((x) => x.symbol === `${c}=X`);
    return (prev ? q?.previousClose : q?.price) ?? null;
  };
  const cross = (a: string, b: string, prev = false) => {
    const pa = perUsd(a, prev);
    const pb = perUsd(b, prev);
    return pa && pb ? pb / pa : null;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 items-center shrink-0">
        <button className={`term-btn ${mode === "price" ? "active" : ""}`} onClick={() => setMode("price")}>
          {t("Rate")}
        </button>
        <button className={`term-btn ${mode === "change" ? "active" : ""}`} onClick={() => setMode("change")}>
          {t("Chg%")}
        </button>
        <span className="dim text-[10px] ml-2">{t("Row = 1 unit of the currency, priced in the column currency")}</span>
      </div>
      {error && <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              {CCY.map((c) => (
                <th key={c} className="amber">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CCY.map((a) => (
              <tr key={a}>
                <td className="amber font-bold">{a}</td>
                {CCY.map((b) => {
                  if (a === b) return <td key={b} className="dim">—</td>;
                  const v = cross(a, b);
                  const p = cross(a, b, true);
                  const chg = v !== null && p ? ((v - p) / p) * 100 : null;
                  return (
                    <td
                      key={b}
                      title={`${a}/${b}`}
                      onClick={() => pick(`${a}${b}=X`)}
                      className={mode === "change" ? (chg === null ? "dim" : chg >= 0 ? "up" : "down") : ""}
                      style={
                        mode === "price" && chg !== null
                          ? { color: chg > 0.01 ? "var(--up)" : chg < -0.01 ? "var(--down)" : undefined }
                          : undefined
                      }
                    >
                      {mode === "price" ? (v === null ? "—" : fmt(v, digits(v))) : chg === null ? "—" : `${fmt(chg)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
