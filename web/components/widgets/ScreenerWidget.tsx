"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass } from "../../lib/api";
import { usePickSymbol, useTerminal } from "../../store/terminal";
import Flash from "../Flash";
import { t } from "../../lib/i18n";

type Row = {
  symbol: string; name: string; price: number | null;
  changePercent: number | null; volume: number | null; marketCap: number | null;
  sector: string;
  pe?: number | null;
};

export default function ScreenerWidget() {
  const setActiveSymbol = usePickSymbol();
  const [market, setMarket] = useState<"us" | "eu">("us");
  const [sector, setSector] = useState("");
  const [changeMin, setChangeMin] = useState("");
  const [marketCapMinB, setMarketCapMinB] = useState("");
  const [volumeMinM, setVolumeMinM] = useState("");
  const [peMin, setPeMin] = useState("");
  const [peMax, setPeMax] = useState("");
  const [sort, setSort] = useState("marketCap");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const { data: sectors = [] } = useQuery({
    queryKey: ["sectors", market],
    queryFn: () => apiGet<string[]>(`/api/sectors?market=${market}`),
    staleTime: 600_000,
  });

  const params = new URLSearchParams();
  params.set("market", market);
  if (sector) params.set("sector", sector);
  if (changeMin) params.set("changeMin", changeMin);
  if (marketCapMinB) params.set("marketCapMin", String(Number(marketCapMinB) * 1e9));
  if (volumeMinM) params.set("volumeMin", String(Number(volumeMinM) * 1e6));
  if (peMin) params.set("peMin", peMin.replace(",", "."));
  if (peMax) params.set("peMax", peMax.replace(",", "."));
  params.set("sort", sort);
  params.set("dir", dir);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["screener", params.toString()],
    queryFn: () => apiGet<Row[]>(`/api/screener?${params}`),
    refetchInterval: 20_000,
  });

  const th = (key: string, label: string) => (
    <th
      onClick={() => {
        if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
        else setSort(key);
      }}
      className={sort === key ? "!text-[var(--amber)]" : ""}
    >
      {label} {sort === key ? (dir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  return (
    <div>
      <div className="flex gap-2 p-1 flex-wrap items-center">
        <div className="flex gap-1">
          {(["us", "eu"] as const).map((m) => (
            <button key={m} className={`term-btn ${market === m ? "active" : ""}`} onClick={() => setMarket(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <select value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">{t("All sectors")}</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input className="w-20" placeholder={t("Chg% min")} value={changeMin} onChange={(e) => setChangeMin(e.target.value)} />
        <input className="w-24" placeholder={t("MCap min ($B)")} value={marketCapMinB} onChange={(e) => setMarketCapMinB(e.target.value)} />
        <input className="w-24" placeholder={t("Vol min (M)")} value={volumeMinM} onChange={(e) => setVolumeMinM(e.target.value)} />
        <input className="w-20" placeholder={t("P/E min")} value={peMin} onChange={(e) => setPeMin(e.target.value)} />
        <input className="w-20" placeholder={t("P/E max")} value={peMax} onChange={(e) => setPeMax(e.target.value)} />
        <span className="dim ml-auto">{isLoading ? "…" : t("{n} results", { n: data.length })}</span>
      </div>
      {error && <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>}
      <table className="data-table">
        <thead>
          <tr>
            {th("symbol", t("Sym"))}
            <th>{t("Name")}</th>
            <th>{t("Sector")}</th>
            {th("price", t("Last"))}
            {th("changePercent", t("Chg%"))}
            {th("volume", "Vol")}
            {th("marketCap", "MCap")}
            {th("pe", t("P/E"))}
          </tr>
        </thead>
        <tbody>
          {data.map((q) => (
            <tr key={q.symbol} onClick={() => setActiveSymbol(q.symbol)}>
              <td className="font-bold">{q.symbol}</td>
              <td className="!text-left max-w-40 truncate">{q.name}</td>
              <td className="!text-left dim">{q.sector}</td>
              <td><Flash value={q.price}>{fmt(q.price)}</Flash></td>
              <td className={pctClass(q.changePercent)}>
                <Flash value={q.changePercent}>{fmt(q.changePercent)}%</Flash>
              </td>
              <td>{fmtBig(q.volume)}</td>
              <td>{fmtBig(q.marketCap)}</td>
              <td className="dim">{q.pe != null && q.pe > 0 ? fmt(q.pe, 1) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
