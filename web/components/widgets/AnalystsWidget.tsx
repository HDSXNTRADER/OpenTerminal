"use client";

import { fmt } from "../../lib/api";
import { useCompany } from "../../lib/company";
import { locale, t } from "../../lib/i18n";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

const BUCKETS = [
  ["strongBuy", "Strong buy", "var(--up)"],
  ["buy", "Buy", "color-mix(in srgb, var(--up) 55%, transparent)"],
  ["hold", "Hold", "var(--text-dim)"],
  ["sell", "Sell", "color-mix(in srgb, var(--down) 55%, transparent)"],
  ["strongSell", "Strong sell", "var(--down)"],
] as const;

const REC_LABEL: Record<string, string> = {
  strong_buy: "Strong buy",
  buy: "Buy",
  hold: "Hold",
  underperform: "Underperform",
  sell: "Sell",
  none: "—",
};

/** Analyst consensus (Bloomberg ANR, free version): rating mix, price targets and recent rating changes. */
export default function AnalystsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { data, isLoading, error } = useCompany(symbol);

  if (error) return <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>;
  if (isLoading || !data) return <div className="p-2 dim">{t("Loading…")}</div>;
  const a = data.analysts;
  if (!a.count && a.trend.length === 0) return <div className="p-2 dim">{t("No analyst coverage for {s}.", { s: symbol })}</div>;

  const upside = a.targetMean && a.price ? ((a.targetMean - a.price) / a.price) * 100 : null;
  const lo = Math.min(a.targetLow ?? Infinity, a.price ?? Infinity);
  const hi = Math.max(a.targetHigh ?? -Infinity, a.price ?? -Infinity);
  const pos = (v: number | null) => (v === null || !isFinite(lo) || hi === lo ? null : ((v - lo) / (hi - lo)) * 100);
  const months = ["0m", "-1m", "-2m", "-3m"];

  return (
    <div className="p-2 space-y-3 text-[11px]">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="amber text-[14px] font-bold">{t(REC_LABEL[a.recommendation ?? "none"] ?? a.recommendation ?? "—")}</span>
        <span className="dim">
          {t("Score")} {fmt(a.mean, 2)} / 5 · {a.count ?? "—"} {t("analysts")}
        </span>
      </div>

      {a.targetMean !== null && (
        <div>
          <div className="dim text-[10px] uppercase mb-1">{t("Price target (12 months)")}</div>
          <div className="flex justify-between">
            <span>
              {t("Average")} <span className="amber">{fmt(a.targetMean)}</span>
            </span>
            <span className={upside === null ? "dim" : upside >= 0 ? "up" : "down"}>
              {upside === null ? "—" : `${upside >= 0 ? "+" : ""}${fmt(upside, 1)}% ${t("vs price")}`}
            </span>
          </div>
          <div className="relative h-3 mt-2 mb-1 bg-[var(--panel-2)] border border-[var(--border)]">
            {[
              [a.price, "var(--text)", t("Price")],
              [a.targetMean, "var(--amber)", t("Average")],
            ].map(([v, color, label]) => {
              const p = pos(v as number | null);
              return p === null ? null : (
                <div key={label as string} title={`${label}: ${fmt(v as number)}`} className="absolute top-[-3px] w-[3px] h-[16px]" style={{ left: `calc(${p}% - 1px)`, background: color as string }} />
              );
            })}
          </div>
          <div className="flex justify-between dim">
            <span>{t("Low")} {fmt(a.targetLow)}</span>
            <span>{t("Price")} {fmt(a.price)}</span>
            <span>{t("High")} {fmt(a.targetHigh)}</span>
          </div>
        </div>
      )}

      {a.trend.length > 0 && (
        <div>
          <div className="dim text-[10px] uppercase mb-1">{t("Ratings by month")}</div>
          {months.map((m) => {
            const r = a.trend.find((x) => x.period === m);
            if (!r) return null;
            const total = BUCKETS.reduce((s, [k]) => s + r[k], 0) || 1;
            return (
              <div key={m} className="flex items-center gap-2 mb-1">
                <span className="dim w-14">{m === "0m" ? t("This month") : t("{n} mo ago", { n: m.slice(1, 2) })}</span>
                <div className="flex flex-1 h-3">
                  {BUCKETS.map(([k, label, color]) =>
                    r[k] ? (
                      <div key={k} title={`${t(label)}: ${r[k]}`} style={{ width: `${(r[k] / total) * 100}%`, background: color }} />
                    ) : null
                  )}
                </div>
                <span className="dim w-6 text-right">{total}</span>
              </div>
            );
          })}
          <div className="flex gap-2 flex-wrap mt-1">
            {BUCKETS.map(([k, label, color]) => (
              <span key={k} className="flex items-center gap-1 dim text-[10px]">
                <span className="inline-block w-2 h-2" style={{ background: color }} />
                {t(label)}
              </span>
            ))}
          </div>
        </div>
      )}

      {a.changes.length > 0 && (
        <div>
          <div className="dim text-[10px] uppercase mb-1">{t("Recent rating changes")}</div>
          <table className="data-table">
            <tbody>
              {a.changes.map((c, i) => (
                <tr key={i}>
                  <td className="dim">{new Date(c.date * 1000).toLocaleDateString(locale())}</td>
                  <td className="!text-left">{c.firm}</td>
                  <td className={c.action === "up" ? "up" : c.action === "down" ? "down" : "dim"}>
                    {c.from && c.from !== c.to ? `${c.from} → ` : ""}
                    {c.to ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="dim text-[10px]">{t("Free data from Yahoo Finance: fewer brokers than Bloomberg.")}</div>
    </div>
  );
}
