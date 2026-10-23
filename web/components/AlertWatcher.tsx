"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet, fmt, type Quote } from "../lib/api";
import { notifyDesktop, playAlertSound } from "../lib/alerts";
import { t } from "../lib/i18n";
import { symbolsParam } from "../lib/symbol";
import { useTerminal, type PriceAlert } from "../store/terminal";

type Toast = { id: string; text: string };

/** Watches prices for every armed alert, whatever widgets are open, and chimes when one crosses. */
export default function AlertWatcher() {
  const alerts = useTerminal((s) => s.alerts);
  const triggerAlert = useTerminal((s) => s.triggerAlert);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const armed = alerts.filter((a) => a.triggeredAt === null);
  const symbols = [...new Set(armed.map((a) => a.symbol))].sort();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fired = useRef(new Set<string>());

  const { data: quotes } = useQuery({
    queryKey: ["alert-quotes", symbols.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`),
    enabled: symbols.length > 0,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!quotes) return;
    const price = new Map(quotes.map((q) => [q.symbol, q.price]));
    for (const a of armed) {
      const p = price.get(a.symbol);
      if (p == null || fired.current.has(a.id)) continue;
      if (crossed(a, p)) {
        fired.current.add(a.id);
        triggerAlert(a.id);
        const text = t("{s} is {dir} {price} (now {now})", {
          s: a.symbol,
          dir: t(a.direction === "above" ? "above" : "below"),
          price: fmt(a.price),
          now: fmt(p),
        });
        playAlertSound();
        notifyDesktop(t("Price alert"), text);
        setToasts((ts) => [...ts, { id: a.id, text }]);
      }
    }
  }, [quotes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-3 right-3 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-[var(--panel-2)] border border-[var(--amber)] px-3 py-2 text-[12px] flex gap-3 items-center shadow-lg"
        >
          <span className="amber font-bold">🔔 {t("Price alert")}</span>
          <span
            className="cursor-pointer hover:underline"
            onClick={() => setActiveSymbol(toast.text.split(" ")[0])}
          >
            {toast.text}
          </span>
          <button className="dim hover:text-[var(--down)]" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== toast.id))}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function crossed(a: PriceAlert, price: number): boolean {
  return a.direction === "above" ? price >= a.price : price <= a.price;
}
