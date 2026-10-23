"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, type Quote } from "../../lib/api";
import { playAlertSound } from "../../lib/alerts";
import { t } from "../../lib/i18n";
import { normalizeSymbol, symbolsParam } from "../../lib/symbol";
import { useTerminal } from "../../store/terminal";

export default function AlertsWidget() {
  const alerts = useTerminal((s) => s.alerts);
  const addAlert = useTerminal((s) => s.addAlert);
  const removeAlert = useTerminal((s) => s.removeAlert);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [bad, setBad] = useState(false);
  const [perm, setPerm] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);

  const symbols = [...new Set(alerts.map((a) => a.symbol))].sort();
  const { data: quotes = [] } = useQuery({
    queryKey: ["alert-quotes", symbols.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`),
    enabled: symbols.length > 0,
    refetchInterval: 5_000,
  });
  const last = (s: string) => quotes.find((q) => q.symbol === s)?.price ?? null;

  const submit = async () => {
    const sym = normalizeSymbol(symbol || activeSymbol);
    const p = Number(price.replace(",", "."));
    if (!sym || !isFinite(p) || p <= 0) return setBad(true);
    // Direction follows where the price is now: a level above it is a breakout alert, below it a drop alert.
    let now = last(sym);
    if (now === null) {
      const q = await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(sym)}`).catch(() => []);
      now = q[0]?.price ?? null;
    }
    addAlert(sym, p, now !== null && p < now ? "below" : "above");
    setPrice("");
    setBad(false);
  };

  return (
    <div className="flex flex-col h-full">
      <form
        className="flex gap-1 p-1 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input className="w-20" placeholder={activeSymbol} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        <input
          className={`w-24 ${bad ? "!border-[var(--down)]" : ""}`}
          placeholder={t("Price")}
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
            setBad(false);
          }}
        />
        <button className="term-btn" type="submit">+ {t("ALERT")}</button>
        <button type="button" className="term-btn" title={t("Test the sound")} onClick={playAlertSound}>
          🔊
        </button>
        {perm === "default" && (
          <button
            type="button"
            className="term-btn"
            onClick={() => Notification.requestPermission().then(setPerm)}
            title={t("Also show alerts as Windows notifications")}
          >
            {t("Enable notifications")}
          </button>
        )}
      </form>
      <div className="dim text-[10px] px-2 pb-1">{t("Tip: you can also create alerts by clicking on a chart with the 🔔 tool.")}</div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Sym")}</th>
            <th>{t("Condition")}</th>
            <th>{t("Last")}</th>
            <th>{t("Status")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id} onClick={() => setActiveSymbol(a.symbol)}>
              <td className="font-bold">{a.symbol}</td>
              <td>
                {a.direction === "above" ? "≥" : "≤"} {fmt(a.price)}
              </td>
              <td>{fmt(last(a.symbol))}</td>
              <td className={a.triggeredAt ? "amber" : "dim"}>
                {a.triggeredAt ? `${t("Triggered")} ${new Date(a.triggeredAt).toLocaleTimeString()}` : t("Waiting")}
              </td>
              <td>
                <button
                  className="dim hover:text-[var(--down)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAlert(a.id);
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {alerts.length === 0 && <div className="p-3 dim">{t("No alerts yet.")}</div>}
    </div>
  );
}
