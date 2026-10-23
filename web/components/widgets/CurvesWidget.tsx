"use client";

import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, fmt } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useTerminal, type WidgetInstance } from "../../store/terminal";

type Curve = { label: string; date: string | null; points: Array<{ tenor: string; years: number; value: number }> };

const COLORS = ["var(--amber)", "#3e63dd", "#30a46c", "#d6409f"];
const DEFAULT_HIDDEN = ["Brazil IPCA+ (real)"];

/** Government yield curves side by side (Bloomberg GC): US Treasuries, euro-area AAA and Brazil (Tesouro Direto). */
export default function CurvesWidget({ widget }: { widget: WidgetInstance }) {
  const setWidgetSettings = useTerminal((s) => s.setWidgetSettings);
  const hidden = (widget.settings?.hidden as string[] | undefined) ?? DEFAULT_HIDDEN;
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["curves"],
    queryFn: () => apiGet<Curve[]>("/api/curves"),
    staleTime: 1_800_000,
    retry: 1,
  });
  const toggle = (label: string) =>
    setWidgetSettings(widget.id, { hidden: hidden.includes(label) ? hidden.filter((h) => h !== label) : [...hidden, label] });

  if (error) return <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>;
  if (isLoading) return <div className="p-2 dim">{t("Loading…")}</div>;
  const shown = data.filter((c) => !hidden.includes(c.label));

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 items-center shrink-0 flex-wrap">
        {data.map((c, i) => (
          <button
            key={c.label}
            className={`term-btn ${hidden.includes(c.label) ? "" : "active"}`}
            style={hidden.includes(c.label) ? undefined : { borderColor: COLORS[i % COLORS.length] }}
            onClick={() => toggle(c.label)}
            title={c.date ? `${t("Date")}: ${c.date}` : undefined}
          >
            {t(c.label)}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
            <CartesianGrid stroke="var(--line)" />
            <XAxis
              type="number"
              dataKey="years"
              scale="sqrt"
              domain={[0, 30]}
              ticks={[0.25, 1, 2, 5, 10, 20, 30]}
              tickFormatter={(v: number) => (v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`)}
              stroke="var(--text-dim)"
              fontSize={9}
              allowDuplicatedCategory={false}
            />
            <YAxis stroke="var(--text-dim)" fontSize={9} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 10 }}
              labelStyle={{ color: "var(--text-dim)" }}
              labelFormatter={(v) => `${t("Maturity")}: ${fmt(Number(v), 1)} ${t("years")}`}
              formatter={(v) => `${fmt(Number(v))}%`}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {data.map((c, i) =>
              hidden.includes(c.label) ? null : (
                <Line
                  key={c.label}
                  data={c.points}
                  dataKey="value"
                  name={t(c.label)}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={1.5}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              )
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {shown.length > 0 && (
        <div className="dim text-[10px] px-2 py-1">
          {shown.map((c) => {
            const short = c.points[0];
            const long = c.points.find((p) => p.years >= 10) ?? c.points[c.points.length - 1];
            const slope = short && long ? (long.value - short.value) * 100 : null;
            return (
              <div key={c.label}>
                {t(c.label)}: {t("short")} {fmt(short?.value)}% · {t("long")} {fmt(long?.value)}% ·{" "}
                <span className={slope === null ? "" : slope >= 0 ? "up" : "down"}>
                  {slope === null ? "—" : `${slope >= 0 ? "+" : ""}${fmt(slope, 0)} bps`}
                </span>{" "}
                {slope !== null && slope < 0 ? `(${t("inverted")})` : ""}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
