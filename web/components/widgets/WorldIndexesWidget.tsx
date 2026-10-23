"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, fmt, pctClass, type Quote } from "../../lib/api";
import { locale, t } from "../../lib/i18n";
import { symbolsParam } from "../../lib/symbol";
import { usePickSymbol } from "../../store/terminal";
import Flash from "../Flash";

type Market = { sym: string; name: string; tz: string; open: string; close: string };

/** Main stock indexes by region (Bloomberg WEI), with each exchange's regular session in local time. */
const REGIONS: Array<[string, Market[]]> = [
  [
    "Americas",
    [
      { sym: "^GSPC", name: "S&P 500", tz: "America/New_York", open: "09:30", close: "16:00" },
      { sym: "^DJI", name: "Dow Jones", tz: "America/New_York", open: "09:30", close: "16:00" },
      { sym: "^IXIC", name: "Nasdaq", tz: "America/New_York", open: "09:30", close: "16:00" },
      { sym: "^RUT", name: "Russell 2000", tz: "America/New_York", open: "09:30", close: "16:00" },
      { sym: "^GSPTSE", name: "S&P/TSX (Canada)", tz: "America/Toronto", open: "09:30", close: "16:00" },
      { sym: "^BVSP", name: "Ibovespa", tz: "America/Sao_Paulo", open: "10:00", close: "17:00" },
      { sym: "^MXX", name: "IPC (Mexico)", tz: "America/Mexico_City", open: "08:30", close: "15:00" },
      { sym: "^MERV", name: "Merval (Argentina)", tz: "America/Argentina/Buenos_Aires", open: "11:00", close: "17:00" },
    ],
  ],
  [
    "Europe",
    [
      { sym: "^STOXX50E", name: "Euro Stoxx 50", tz: "Europe/Berlin", open: "09:00", close: "17:30" },
      { sym: "^FTSE", name: "FTSE 100 (UK)", tz: "Europe/London", open: "08:00", close: "16:30" },
      { sym: "^GDAXI", name: "DAX (Germany)", tz: "Europe/Berlin", open: "09:00", close: "17:30" },
      { sym: "^FCHI", name: "CAC 40 (France)", tz: "Europe/Paris", open: "09:00", close: "17:30" },
      { sym: "FTSEMIB.MI", name: "FTSE MIB (Italy)", tz: "Europe/Rome", open: "09:00", close: "17:30" },
      { sym: "^IBEX", name: "IBEX 35 (Spain)", tz: "Europe/Madrid", open: "09:00", close: "17:30" },
      { sym: "^AEX", name: "AEX (Netherlands)", tz: "Europe/Amsterdam", open: "09:00", close: "17:30" },
      { sym: "^SSMI", name: "SMI (Switzerland)", tz: "Europe/Zurich", open: "09:00", close: "17:30" },
    ],
  ],
  [
    "Asia / Pacific",
    [
      { sym: "^N225", name: "Nikkei 225 (Japan)", tz: "Asia/Tokyo", open: "09:00", close: "15:30" },
      { sym: "^HSI", name: "Hang Seng (Hong Kong)", tz: "Asia/Hong_Kong", open: "09:30", close: "16:00" },
      { sym: "000001.SS", name: "Shanghai Composite", tz: "Asia/Shanghai", open: "09:30", close: "15:00" },
      { sym: "^KS11", name: "KOSPI (Korea)", tz: "Asia/Seoul", open: "09:00", close: "15:30" },
      { sym: "^TWII", name: "TAIEX (Taiwan)", tz: "Asia/Taipei", open: "09:00", close: "13:30" },
      { sym: "^BSESN", name: "Sensex (India)", tz: "Asia/Kolkata", open: "09:15", close: "15:30" },
      { sym: "^AXJO", name: "ASX 200 (Australia)", tz: "Australia/Sydney", open: "10:00", close: "16:00" },
      { sym: "^STI", name: "STI (Singapore)", tz: "Asia/Singapore", open: "09:00", close: "17:00" },
    ],
  ],
];

/** Local clock of a time zone, and whether its regular session is running (weekends closed; holidays not known). */
function sessionState(m: Market, now: Date): { clock: string; open: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: m.tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hhmm = `${get("hour")}:${get("minute")}`;
  const weekend = get("weekday") === "Sat" || get("weekday") === "Sun";
  return { clock: hhmm, open: !weekend && hhmm >= m.open && hhmm < m.close };
}

export default function WorldIndexesWidget() {
  const pick = usePickSymbol();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const all = REGIONS.flatMap(([, ms]) => ms.map((m) => m.sym));
  const { data: quotes = [], error } = useQuery({
    queryKey: ["world-indexes"],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(all)}`),
    refetchInterval: 15_000,
  });
  const q = (s: string) => quotes.find((x) => x.symbol === s);

  return (
    <div>
      {error && <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Index")}</th>
            <th>{t("Last")}</th>
            <th>{t("Chg%")}</th>
            <th>{t("Local time")}</th>
            <th>{t("Market")}</th>
          </tr>
        </thead>
        <tbody>
          {REGIONS.map(([region, markets]) => [
            <tr key={region}>
              <td colSpan={5} className="!text-left amber text-[10px] uppercase pt-2">
                {t(region)}
              </td>
            </tr>,
            ...markets.map((m) => {
              const x = q(m.sym);
              const s = sessionState(m, now);
              return (
                <tr key={m.sym} onClick={() => pick(m.sym)} title={`${m.sym} · ${m.open}–${m.close} (${m.tz})`}>
                  <td className="font-bold">{m.name}</td>
                  <td>
                    <Flash value={x?.price}>{x?.price != null ? x.price.toLocaleString(locale(), { maximumFractionDigits: 2 }) : "—"}</Flash>
                  </td>
                  <td className={pctClass(x?.changePercent)}>
                    <Flash value={x?.changePercent}>{fmt(x?.changePercent)}%</Flash>
                  </td>
                  <td className="dim">{s.clock}</td>
                  <td className={s.open ? "up" : "dim"}>{s.open ? `● ${t("OPEN")}` : `○ ${t("CLOSED")}`}</td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
      <div className="dim text-[10px] px-2 py-1">{t("Open/closed follows regular hours; holidays are not considered.")}</div>
    </div>
  );
}
