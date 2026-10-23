"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass, type Quote } from "../../lib/api";
import { t } from "../../lib/i18n";
import { symbolsParam } from "../../lib/symbol";
import { usePickSymbol } from "../../store/terminal";
import Flash from "../Flash";

/** Front-month futures (Yahoo "=F" tickers), grouped like Bloomberg's CMDTY screen. */
const GROUPS: Array<[string, Array<[string, string, string]>]> = [
  [
    "Energy",
    [
      ["CL=F", "WTI Crude", "USD/bbl"],
      ["BZ=F", "Brent Crude", "USD/bbl"],
      ["NG=F", "Natural Gas", "USD/MMBtu"],
      ["RB=F", "Gasoline", "USD/gal"],
      ["HO=F", "Heating Oil", "USD/gal"],
    ],
  ],
  [
    "Metals",
    [
      ["GC=F", "Gold", "USD/oz"],
      ["SI=F", "Silver", "USD/oz"],
      ["HG=F", "Copper", "USD/lb"],
      ["PL=F", "Platinum", "USD/oz"],
      ["PA=F", "Palladium", "USD/oz"],
    ],
  ],
  [
    "Agriculture",
    [
      ["ZS=F", "Soybeans", "USc/bu"],
      ["ZC=F", "Corn", "USc/bu"],
      ["ZW=F", "Wheat", "USc/bu"],
      ["KC=F", "Coffee", "USc/lb"],
      ["SB=F", "Sugar", "USc/lb"],
      ["CT=F", "Cotton", "USc/lb"],
      ["CC=F", "Cocoa", "USD/t"],
      ["LE=F", "Live Cattle", "USc/lb"],
    ],
  ],
];

export default function CommoditiesWidget() {
  const pick = usePickSymbol();
  const all = GROUPS.flatMap(([, rows]) => rows.map(([s]) => s));
  const { data: quotes = [], error } = useQuery({
    queryKey: ["commodities"],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(all)}`),
    refetchInterval: 10_000,
  });
  const q = (s: string) => quotes.find((x) => x.symbol === s);

  return (
    <div>
      {error && <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Commodity")}</th>
            <th>{t("Last")}</th>
            <th>{t("Chg")}</th>
            <th>{t("Chg%")}</th>
            <th>{t("Unit")}</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map(([group, rows]) => [
            <tr key={group}>
              <td colSpan={5} className="!text-left amber text-[10px] uppercase pt-2">
                {t(group)}
              </td>
            </tr>,
            ...rows.map(([sym, label, unit]) => {
              const x = q(sym);
              return (
                <tr key={sym} onClick={() => pick(sym)} title={sym}>
                  <td className="font-bold">{t(label)}</td>
                  <td>
                    <Flash value={x?.price}>{fmt(x?.price)}</Flash>
                  </td>
                  <td className={pctClass(x?.change)}>{fmt(x?.change)}</td>
                  <td className={pctClass(x?.changePercent)}>
                    <Flash value={x?.changePercent}>{fmt(x?.changePercent)}%</Flash>
                  </td>
                  <td className="dim text-[10px]">{unit}</td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}
