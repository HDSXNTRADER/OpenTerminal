"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { t } from "../../lib/i18n";

type OptionRow = {
  strike: number | null; lastPrice: number | null; bid: number | null; ask: number | null;
  volume: number | null; openInterest: number | null; impliedVolatility?: number | null; inTheMoney: boolean;
};
type Chain = {
  symbol: string; underlyingPrice: number | null; expirationDates: string[];
  selectedDate: string | null; calls: OptionRow[]; puts: OptionRow[];
};

export default function OptionsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [expiry, setExpiry] = useState<string | undefined>();
  const [view, setView] = useState<"chain" | "vol">("chain");

  const { data, error, isLoading } = useQuery({
    queryKey: ["options", symbol, expiry],
    queryFn: () => apiGet<Chain>(`/api/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`),
    refetchInterval: 20_000,
    retry: 0,
  });

  if (error)
    return (
      <div className="p-2">
        <div className="down">{t("Option chain unavailable for {s}", { s: symbol })}</div>
        <div className="dim">{t((error as Error).message)}</div>
      </div>
    );
  if (isLoading || !data) return <div className="p-2 dim">{t("Loading option chain…")}</div>;

  const byStrike = new Map<number, { call?: OptionRow; put?: OptionRow }>();
  for (const c of data.calls) if (c.strike !== null) byStrike.set(c.strike, { ...byStrike.get(c.strike), call: c });
  for (const p of data.puts) if (p.strike !== null) byStrike.set(p.strike, { ...byStrike.get(p.strike), put: p });
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);

  return (
    <div>
      <div className="flex gap-2 items-center p-1">
        <span className="dim">{t("Underlying")}</span>
        <span className="amber font-bold">{fmt(data.underlyingPrice)}</span>
        <span className="dim ml-2">{t("Expiry")}</span>
        <select
          value={expiry ?? data.selectedDate ?? ""}
          onChange={(e) => setExpiry(e.target.value)}
        >
          {data.expirationDates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <span className="ml-auto flex gap-1">
          <button className={`term-btn ${view === "chain" ? "active" : ""}`} onClick={() => setView("chain")}>
            {t("CHAIN")}
          </button>
          <button
            className={`term-btn ${view === "vol" ? "active" : ""}`}
            title={t("Implied volatility by strike (volatility smile)")}
            onClick={() => setView("vol")}
          >
            {t("VOLATILITY")}
          </button>
        </span>
      </div>
      {view === "vol" ? <VolSmile strikes={strikes} byStrike={byStrike} spot={data.underlyingPrice} /> : (
      <table className="data-table">
        <thead>
          <tr>
            <th colSpan={5} className="!text-center up">{t("CALLS")}</th>
            <th className="!text-center">{t("STRIKE")}</th>
            <th colSpan={5} className="!text-center down">{t("PUTS")}</th>
          </tr>
          <tr>
            <th>{t("Last")}</th><th>{t("Bid")}</th><th>{t("Ask")}</th><th>{t("Vol")}</th><th>OI · IV</th>
            <th></th>
            <th>{t("Last")}</th><th>{t("Bid")}</th><th>{t("Ask")}</th><th>{t("Vol")}</th><th>OI · IV</th>
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike) => {
            const { call, put } = byStrike.get(strike)!;
            return (
              <tr key={strike}>
                <td className={call?.inTheMoney ? "bg-[color-mix(in_srgb,var(--up)_14%,transparent)]" : ""}>{fmt(call?.lastPrice)}</td>
                <td className={call?.inTheMoney ? "bg-[color-mix(in_srgb,var(--up)_14%,transparent)]" : ""}>{fmt(call?.bid)}</td>
                <td className={call?.inTheMoney ? "bg-[color-mix(in_srgb,var(--up)_14%,transparent)]" : ""}>{fmt(call?.ask)}</td>
                <td className={call?.inTheMoney ? "bg-[color-mix(in_srgb,var(--up)_14%,transparent)]" : ""}>{fmtBig(call?.volume)}</td>
                <td className={call?.inTheMoney ? "bg-[color-mix(in_srgb,var(--up)_14%,transparent)]" : ""}>
                  {fmtBig(call?.openInterest)} · {call?.impliedVolatility ? fmt(call.impliedVolatility * 100, 0) + "%" : "—"}
                </td>
                <td className="!text-center font-bold amber">{fmt(strike)}</td>
                <td className={put?.inTheMoney ? "bg-[color-mix(in_srgb,var(--down)_14%,transparent)]" : ""}>{fmt(put?.lastPrice)}</td>
                <td className={put?.inTheMoney ? "bg-[color-mix(in_srgb,var(--down)_14%,transparent)]" : ""}>{fmt(put?.bid)}</td>
                <td className={put?.inTheMoney ? "bg-[color-mix(in_srgb,var(--down)_14%,transparent)]" : ""}>{fmt(put?.ask)}</td>
                <td className={put?.inTheMoney ? "bg-[color-mix(in_srgb,var(--down)_14%,transparent)]" : ""}>{fmtBig(put?.volume)}</td>
                <td className={put?.inTheMoney ? "bg-[color-mix(in_srgb,var(--down)_14%,transparent)]" : ""}>
                  {fmtBig(put?.openInterest)} · {put?.impliedVolatility ? fmt(put.impliedVolatility * 100, 0) + "%" : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
    </div>
  );
}

/** Implied volatility per strike for calls and puts, with the current price marked. */
function VolSmile({
  strikes,
  byStrike,
  spot,
}: {
  strikes: number[];
  byStrike: Map<number, { call?: OptionRow; put?: OptionRow }>;
  spot: number | null;
}) {
  const rows = useMemo(
    () =>
      strikes
        .map((k) => {
          const iv = (r?: OptionRow) => (r?.impliedVolatility && r.impliedVolatility > 0.001 ? +(r.impliedVolatility * 100).toFixed(1) : null);
          return { strike: k, call: iv(byStrike.get(k)?.call), put: iv(byStrike.get(k)?.put) };
        })
        .filter((r) => r.call !== null || r.put !== null),
    [strikes, byStrike]
  );
  // At-the-money IV: the strike closest to the current price.
  const atm = spot === null ? null : rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), null);
  if (rows.length === 0) return <div className="p-3 dim">{t("No implied volatility data for this expiry.")}</div>;
  return (
    <div className="flex flex-col" style={{ height: 260 }}>
      {atm && (
        <div className="px-2 text-[11px] dim">
          {t("At-the-money IV")}: <span className="amber">{fmt(atm.call ?? atm.put, 1)}%</span> ({t("strike")} {fmt(atm.strike)})
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: -10 }}>
          <CartesianGrid stroke="var(--line)" />
          <XAxis dataKey="strike" stroke="var(--text-dim)" fontSize={9} type="number" domain={["dataMin", "dataMax"]} />
          <YAxis stroke="var(--text-dim)" fontSize={9} unit="%" />
          <Tooltip
            contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 10 }}
            labelStyle={{ color: "var(--text-dim)" }}
            formatter={(v: number) => `${v}%`}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {spot !== null && <ReferenceLine x={spot} stroke="var(--amber)" strokeDasharray="3 3" />}
          <Line type="monotone" dataKey="call" name="Calls" stroke="var(--up)" dot={false} connectNulls />
          <Line type="monotone" dataKey="put" name="Puts" stroke="var(--down)" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
