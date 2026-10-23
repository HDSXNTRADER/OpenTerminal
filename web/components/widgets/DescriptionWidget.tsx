"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { useCompany } from "../../lib/company";
import { t } from "../../lib/i18n";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

/** Company description (Bloomberg DES): what the company does, key facts and management. */
export default function DescriptionWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { data, isLoading, error } = useCompany(symbol);
  const { data: quote } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbol)}`))[0],
    refetchInterval: 15_000,
  });

  if (error) return <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>;
  if (isLoading || !data) return <div className="p-2 dim">{t("Loading…")}</div>;

  const facts: Array<[string, string]> = [
    [t("Sector"), data.sector ? t(data.sector) : "—"],
    [t("Industry"), data.industry ?? "—"],
    [t("Country"), [data.city, data.country].filter(Boolean).join(", ") || "—"],
    [t("Employees"), data.employees ? data.employees.toLocaleString() : "—"],
    [t("Mkt Cap"), fmtBig(data.marketCap ?? quote?.marketCap)],
    ["P/E", fmt(quote?.pe)],
    [t("Div. yield"), quote?.dividendYield != null ? `${fmt(quote.dividendYield)}%` : "—"],
    [t("52w range"), `${fmt(quote?.week52Low)} – ${fmt(quote?.week52High)}`],
  ];

  return (
    <div className="p-2 space-y-2 text-[11px]">
      <div>
        <div className="amber text-[13px] font-bold">{data.name ?? symbol}</div>
        <div className="dim">
          {symbol}
          {data.exchange ? ` · ${data.exchange}` : ""}
          {data.currency ? ` · ${data.currency}` : ""}
          {quote?.price != null && (
            <>
              {" · "}
              <span className="text-[var(--text)]">{fmt(quote.price)}</span>{" "}
              <span className={pctClass(quote.changePercent)}>{fmt(quote.changePercent)}%</span>
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-[var(--line)] py-0.5">
            <span className="dim">{k}</span>
            <span className="text-right truncate ml-2">{v}</span>
          </div>
        ))}
      </div>
      {data.website && (
        <a href={data.website} target="_blank" rel="noreferrer" className="amber underline">
          {data.website.replace(/^https?:\/\//, "")}
        </a>
      )}
      {data.description && <p className="leading-relaxed whitespace-pre-line">{data.description}</p>}
      {data.officers.length > 0 && (
        <div>
          <div className="dim text-[10px] uppercase mb-1">{t("Management")}</div>
          {data.officers.map((o) => (
            <div key={o.name} className="flex justify-between">
              <span>{o.name}</span>
              <span className="dim truncate ml-2">{o.title}</span>
            </div>
          ))}
        </div>
      )}
      <div className="dim text-[10px]">{t("Source")}: {data.source}</div>
    </div>
  );
}
